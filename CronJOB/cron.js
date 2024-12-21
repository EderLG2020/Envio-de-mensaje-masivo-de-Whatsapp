/****************************************************
 * DEPENDENCIAS
 ****************************************************/
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const Redis = require('ioredis');
const Bull = require('bull');
const winston = require('winston');
const Joi = require('joi');

/****************************************************
 * CONFIGURACIÓN DE LOGS (WINSTON)
 ****************************************************/
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(
      (info) => `[${info.timestamp}] ${info.level.toUpperCase()}: ${info.message}`
    )
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'envio.log' }),
  ],
  exitOnError: false,
});

/****************************************************
 * CONFIGURACIÓN GENERAL
 ****************************************************/
const CONFIG = {
  // URL de Redis (en el mismo servidor)
  REDIS_URL: 'redis://127.0.0.1:6379',

  // Polling para instancias
  POLLING_INSTANCES_INTERVAL: 8000, // cada 8s revisamos instancias

  // Polling adaptativo (mínimo y máximo)
  MIN_POLL_INTERVAL: 3000,   // 3s
  MAX_POLL_INTERVAL: 15000,  // 15s

  // Lógica de envío
  MAX_MESSAGES_PER_INSTANCE: 7,

  MESSAGE_INTERVAL_MIN: 2000,  // 2s
  MESSAGE_INTERVAL_MAX: 5000,  // 5s

  EXTENDED_PAUSE_PROBABILITY: 0.2,
  EXTENDED_PAUSE_MIN: 8000,     // 8s
  EXTENDED_PAUSE_MAX: 20000,    // 20s

  OCCASIONAL_BREAK_PROBABILITY: 0.05,
  OCCASIONAL_BREAK_MIN: 20000,  // 20s
  OCCASIONAL_BREAK_MAX: 60000,  // 60s

  // Retries
  RETRY_DELAY_MIN: 3000, // 3s
  RETRY_DELAY_MAX: 8000, // 8s
  MAX_RETRIES: 3,

  // APIs
  QUEUE_API_URL: 'http://188.245.38.255:5000/api/sendwhatsapp/colaenvio/?empresa=yego',
  CONFIRMATION_API_URL: 'http://188.245.38.255:5000/api/sendwhatsapp/envio',
  INSTANCES_API_URL: 'http://localhost:5000/api/instances',
  SEND_MESSAGE_API_BASE_URL: 'https://apievo.3w.pe/message/sendText/',

  // Archivo de persistencia
  SENT_MESSAGES_FILE: path.join(__dirname, 'sentMessages.json'),
  LOG_ENCODING: 'utf8',
};

/****************************************************
 * VALIDACIÓN DE MENSAJES
 ****************************************************/
const messageSchema = Joi.object({
  idSendmessage: Joi.number().required(),
  tenvio: Joi.string().required(),
  mensaje: Joi.string().required(),
}).unknown(true);

/****************************************************
 * VARIABLES GLOBALES
 ****************************************************/
// Lista de instancias activas
let activeInstances = [];

// IDs de mensajes que ya se enviaron (persistidos)
let sentMessages = new Set();

// Conexión Redis
const redisConnection = new Redis(CONFIG.REDIS_URL);

// Cola principal en Bull
const sendQueue = new Bull('sendQueue', {
  redis: CONFIG.REDIS_URL,
  defaultJobOptions: {
    removeOnComplete: 5000, // limpia jobs antiguos al completarlos
    removeOnFail: 5000,
  },
});

// Estadísticas por instancia (para conteos y pausas)
const instanceStats = {};

// Para poder descartar mensajes que ya no están en la cola remota,
// mantenemos una lista de IDs “vigentes” que la API nos devolvió
let remoteValidIds = new Set();

/****************************************************
 * FUNCIONES DE UTILIDAD (TIEMPOS, ETC.)
 ****************************************************/
function getRandomTime(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Simula tiempo de tipeo según número de palabras (para evitar spam).
 */
function simulateTypingTime(message) {
  const words = (message || '').split(' ').length;
  const readingTime = getRandomTime(1000, 2000);      // leer
  const writingTime = getRandomTime(1500, 3000) + words * getRandomTime(50, 100);
  return readingTime + writingTime;
}

/**
 * Retorna una pausa (pequeña o extendida) para separar envíos.
 */
function getExtendedPauseTime() {
  if (Math.random() < CONFIG.EXTENDED_PAUSE_PROBABILITY) {
    return getRandomTime(CONFIG.EXTENDED_PAUSE_MIN, CONFIG.EXTENDED_PAUSE_MAX);
  }
  return getRandomTime(CONFIG.MESSAGE_INTERVAL_MIN, CONFIG.MESSAGE_INTERVAL_MAX);
}

/**
 * Retorna una “pausa ocasional” más larga, con cierta probabilidad.
 */
function simulateOccasionalBreak() {
  if (Math.random() < CONFIG.OCCASIONAL_BREAK_PROBABILITY) {
    return getRandomTime(CONFIG.OCCASIONAL_BREAK_MIN, CONFIG.OCCASIONAL_BREAK_MAX);
  }
  return 0;
}

/****************************************************
 * PERSISTENCIA DE MENSAJES ENVIADOS
 ****************************************************/
async function loadSentMessages() {
  try {
    const data = await fs.readFile(CONFIG.SENT_MESSAGES_FILE, CONFIG.LOG_ENCODING);
    const parsed = JSON.parse(data);
    sentMessages = new Set(parsed);
    logger.info(`✅ Cargados ${sentMessages.size} mensajes previamente enviados.`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.writeFile(CONFIG.SENT_MESSAGES_FILE, JSON.stringify([], null, 2), CONFIG.LOG_ENCODING);
      sentMessages = new Set();
      logger.info('✅ Archivo de mensajes enviados creado (no existía).');
    } else {
      logger.error(`⚠️ Error al cargar mensajes enviados: ${error.message}`);
      sentMessages = new Set();
    }
  }
}

async function saveSentMessages() {
  try {
    await fs.writeFile(
      CONFIG.SENT_MESSAGES_FILE,
      JSON.stringify([...sentMessages], null, 2),
      CONFIG.LOG_ENCODING
    );
    logger.info(`✅ Guardados ${sentMessages.size} mensajes enviados en el archivo.`);
  } catch (error) {
    logger.error(`⚠️ Error al guardar mensajes enviados: ${error.message}`);
  }
}

/****************************************************
 * CONSULTA DE COLA REMOTA Y SINCRONIZACIÓN
 ****************************************************/

let currentPollInterval = CONFIG.MIN_POLL_INTERVAL;
let pollTimeout = null;

/**
 * Consulta la cola remota, obtiene la lista completa de mensajes vigentes,
 * encola los que sean nuevos y elimina de la cola local (Bull) los que ya no están.
 */
async function updateLocalQueueFromRemote() {
  try {
    logger.info('🔄 Polling adaptativo: consultando cola...');
    const response = await axios.get(CONFIG.QUEUE_API_URL);

    if (response.data?.message?.includes('No hay registros')) {
      logger.info('📭 No hay mensajes en la cola (API).');
      remoteValidIds = new Set(); // se vacía
      // Aumentamos el intervalo (no hay msgs)
      currentPollInterval = Math.min(currentPollInterval * 1.5, CONFIG.MAX_POLL_INTERVAL);
      // Y también removemos todos los jobs waiting/delayed porque la API está vacía
      await removeNonExistingJobs(new Set());
      return;
    }

    // Determina si es un array o un solo objeto
    let incoming = [];
    if (Array.isArray(response.data)) {
      incoming = response.data;
    } else {
      incoming = [response.data];
    }

    // Set con todos los IDs remotos
    const freshIds = new Set();
    let newCount = 0;

    for (const rawMsg of incoming) {
      // Valida con Joi
      const { error, value } = messageSchema.validate(rawMsg);
      if (error) {
        logger.error(`❌ Mensaje inválido: ${error.message}. Data: ${JSON.stringify(rawMsg)}`);
        continue;
      }
      freshIds.add(value.idSendmessage);

      // Si ya está enviado, skip
      if (sentMessages.has(value.idSendmessage)) {
        continue;
      }

      // Ver si ya existe un job en Bull
      // (Podríamos optimizar: Bull no siempre es sencillo de “buscar” por IDSendmessage,
      //  pero en este ejemplo, iremos directo a encolar y, si es duplicado, no pasa mucho
      //  ... O lo marcamos con un custom jobId)
      
      // Para evitar duplicados, podemos usar jobId = `msg-${value.idSendmessage}`
      //  => si ya existe, Bull no lo duplica.
      const jobId = `msg-${value.idSendmessage}`;
      try {
        const existingJob = await sendQueue.getJob(jobId);
        if (!existingJob) {
          // Encolamos
          await sendQueue.add(value, { jobId });
          newCount++;
        }
      } catch (err) {
        logger.error(`Error checking existingJob: ${err.message}`);
        // De todas formas intentamos encolar
        await sendQueue.add(value);
        newCount++;
      }
    }

    remoteValidIds = freshIds; // Actualizamos la lista global de IDs vigentes

    if (newCount > 0) {
      logger.info(`📬 Se encolaron ${newCount} mensajes nuevos en Bull.`);
      // Si hubo nuevos, reducimos el intervalo
      currentPollInterval = CONFIG.MIN_POLL_INTERVAL;
    } else {
      logger.info('📭 No hay mensajes nuevos para encolar (de la API).');
      currentPollInterval = Math.min(currentPollInterval * 1.2, CONFIG.MAX_POLL_INTERVAL);
    }

    // Ahora, eliminamos de la cola local los que ya no estén en 'freshIds'
    await removeNonExistingJobs(freshIds);

  } catch (err) {
    logger.error(`⚠️ Error al obtener cola: ${err.message}`);
    // en caso de error, reintentar en 10s
    currentPollInterval = 10000;
  } finally {
    pollTimeout = setTimeout(updateLocalQueueFromRemote, currentPollInterval);
  }
}

/**
 * Elimina de la cola local (Bull) los jobs en estado `waiting` o `delayed`
 * cuyos idSendmessage NO estén en la lista `remoteIds`.
 */
async function removeNonExistingJobs(remoteIds) {
  const jobsInQueue = await sendQueue.getJobs(['waiting', 'delayed']);
  let removedCount = 0;
  for (const job of jobsInQueue) {
    const data = job.data;
    if (!remoteIds.has(data.idSendmessage)) {
      logger.info(
        `🗑️ Eliminando Job#${job.id} (idSendmessage=${data.idSendmessage}) pues ya no está en cola remota.`
      );
      await job.remove();
      removedCount++;
    }
  }
  if (removedCount > 0) {
    logger.info(`🗑️ Se eliminaron ${removedCount} jobs obsoletos de la cola local.`);
  }
}

/****************************************************
 * POLLING DE INSTANCIAS
 ****************************************************/
async function updateActiveInstances() {
  try {
    logger.info('🔍 Consultando instancias activas...');
    const resp = await axios.get(CONFIG.INSTANCES_API_URL);
    const openOnes = resp.data.filter((inst) => inst.connectionStatus === 'open');
    if (!openOnes.length) {
      logger.warn('⚪ No se encontraron instancias activas.');
      activeInstances = [];
      return;
    }
    activeInstances = openOnes.map((inst) => ({
      name: inst.name,
      token: inst.token,
    }));
    logger.info(
      `🟢 Instancias activas: ${activeInstances.map((i) => i.name).join(', ')}`
    );
  } catch (error) {
    logger.error(`⚠️ Error al obtener instancias: ${error.message}`);
    activeInstances = [];
  }
}

/**
 * Escoge una instancia que esté en `activeInstances`.
 * Podrías implementar round-robin, o la que tenga menos conteo, etc.
 */
function getAvailableInstance() {
  const candidates = activeInstances.map((inst) => {
    // extra stats
    const stat = instanceStats[inst.name] || { count: 0 };
    return { ...inst, ...stat };
  });
  if (!candidates.length) {
    return null;
  }
  // Ordenar por la que tenga menos count
  candidates.sort((a, b) => (a.count || 0) - (b.count || 0));
  return candidates[0];
}

/****************************************************
 * PROCESADOR DE JOBS (BULL)
 ****************************************************/
// Concurrency 3: hasta 3 mensajes en paralelo por proceso
sendQueue.process(3, async (job) => {
  const data = job.data; // { idSendmessage, tenvio, mensaje }

  // Chequeo final: ¿Sigue el ID en la cola remota?
  // (Este set se actualiza en cada poll)
  if (!remoteValidIds.has(data.idSendmessage)) {
    logger.warn(
      `⚠️ [Job#${job.id}] ID ${data.idSendmessage} ya no está en la cola remota. Cancelando envío.`
    );
    return;
  }

  // Ya se envió?
  if (sentMessages.has(data.idSendmessage)) {
    logger.info(`⚠️ [Job#${job.id}] Mensaje ${data.idSendmessage} ya se había enviado. Abortando.`);
    return;
  }

  // Elige instancia
  const inst = getAvailableInstance();
  if (!inst) {
    logger.warn(`⚠️ [Job#${job.id}] No hay instancias disponibles. Reintentando en 15s.`);
    // Lanzar error => reintento
    throw new Error('No instance available');
  }

  // Stats local
  if (!instanceStats[inst.name]) {
    instanceStats[inst.name] = { count: 0 };
  }

  // Si la instancia está en su límite, hacemos pausa
  if (instanceStats[inst.name].count >= CONFIG.MAX_MESSAGES_PER_INSTANCE) {
    // Ocasional break
    const breakTime = simulateOccasionalBreak();
    if (breakTime > 0) {
      logger.info(
        `🛑 [${inst.name}] Pausa ocasional de ${(breakTime / 1000).toFixed(2)}s (límite msgs).`
      );
      await new Promise((r) => setTimeout(r, breakTime));
      instanceStats[inst.name].count = 0;
    } else {
      const extended = getExtendedPauseTime();
      logger.info(
        `⏳ [${inst.name}] Pausa de ${(extended / 1000).toFixed(2)}s (límite msgs).`
      );
      await new Promise((r) => setTimeout(r, extended));
      instanceStats[inst.name].count = 0;
    }
  }

  // Simular tipeo
  const typingDelay = simulateTypingTime(data.mensaje);
  logger.info(`⌨️ [${inst.name}] Simulando escritura ${typingDelay}ms para msg #${data.idSendmessage}`);
  await new Promise((r) => setTimeout(r, typingDelay));

  logger.info(`📤 [${inst.name}] Enviando msg #${data.idSendmessage} a ${data.tenvio}`);
  try {
    const resp = await axios.post(
      `${CONFIG.SEND_MESSAGE_API_BASE_URL}${inst.name}`,
      {
        number: data.tenvio,
        text: data.mensaje,
      },
      {
        headers: { Apikey: inst.token },
        timeout: 30000,
      }
    );

    if (resp.status === 200 || resp.status === 201) {
      logger.info(`✅ [${inst.name}] Msg #${data.idSendmessage} enviado OK.`);
      sentMessages.add(data.idSendmessage);
      await saveSentMessages();
    } else {
      logger.warn(`⚠️ [${inst.name}] Respuesta inesperada: ${resp.status} para msg #${data.idSendmessage}`);
    }

    // Confirmar envío
    await confirmMessageSend(resp.status, data.idSendmessage, inst.name);

    // Sumar count
    instanceStats[inst.name].count = (instanceStats[inst.name].count || 0) + 1;

    // Pausa final “normal” (para no spamear)
    const waitTime = getExtendedPauseTime();
    logger.info(`⏳ [${inst.name}] Espera de ${(waitTime / 1000).toFixed(2)}s tras enviar.`);
    await new Promise((r) => setTimeout(r, waitTime));

    return; // Éxito
  } catch (err) {
    logger.error(`❌ [${inst.name}] Error enviando msg #${data.idSendmessage}: ${err.message}`);
    // si es 400 => no reintentar
    if (err.response?.status === 400) {
      logger.warn(`⚠️ [${inst.name}] Status 400 => no reintentar. Confirmamos como fallido.`);
      await confirmMessageSend(400, data.idSendmessage, inst.name);
      return;
    }
    // Cualquier otro error => throw para que Bull reintente
    throw err;
  }
});

/**
 * Configurar reintentos en Bull:
 * - Hasta MAX_RETRIES
 * - Delay aleatorio entre reintentos
 */
sendQueue.on('failed', async (job, err) => {
  const attemptsMade = job.attemptsMade || 1;
  logger.warn(`🔴 Job#${job.id} falló (intento ${attemptsMade}): ${err.message}`);
  if (attemptsMade >= CONFIG.MAX_RETRIES) {
    logger.error(`❌ Job#${job.id} agotó reintentos (${CONFIG.MAX_RETRIES}). Marcado failed.`);
  } else {
    // Aumentar “backoff” de forma fija o aleatoria
    const retryDelay = getRandomTime(CONFIG.RETRY_DELAY_MIN, CONFIG.RETRY_DELAY_MAX);
    job.opts.backoff = { type: 'fixed', delay: retryDelay };
  }
});

/****************************************************
 * CONFIRMACIÓN DE ENVÍO
 ****************************************************/
async function confirmMessageSend(statusCode, idSendmessage, instanceName) {
  const cenvio = (statusCode === 200 || statusCode === 201) ? 1 : 2;
  try {
    const resp = await axios.post(CONFIG.CONFIRMATION_API_URL, {
      Idenvio: idSendmessage,
      Ninstancia: instanceName,
      Cenvio: cenvio,
    });
    logger.info(`✅ Confirmación #${idSendmessage} (cenvio=${cenvio}), resp ${resp.status}`);
  } catch (error) {
    logger.error(`⚠️ Error al confirmar envío #${idSendmessage}: ${error.message}`);
  }
}

/****************************************************
 * INICIALIZACIÓN
 ****************************************************/
async function init() {
  // 1) Carga de IDs previos
  await loadSentMessages();

  // 2) Polling adaptativo para la cola remota
  updateLocalQueueFromRemote(); // arranca la primera vez

  // 3) Polling instancias
  setInterval(updateActiveInstances, CONFIG.POLLING_INSTANCES_INTERVAL);
  // Llamada inicial
  updateActiveInstances();

  // 4) Configurar reintentos globales en la cola
  sendQueue.defaultJobOptions = {
    attempts: CONFIG.MAX_RETRIES,
    backoff: {
      type: 'fixed',
      delay: 5000,
    },
  };

  logger.info('🚀 Sistema inicializado. Esperando mensajes...');
}

init().catch((err) => {
  logger.error(`Error crítico en init(): ${err.message}`);
  process.exit(1);
});

/****************************************************
 * ERRORES GLOBALES
 ****************************************************/
process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});
process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.message}`);
  process.exit(1);
});
