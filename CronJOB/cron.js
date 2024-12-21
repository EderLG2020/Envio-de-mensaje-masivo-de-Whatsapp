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
  level: 'debug', // puedes usar 'info' o 'debug' para más detalle
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
  // URL de Redis
  REDIS_URL: 'redis://127.0.0.1:6379',

  // Polling
  POLLING_INSTANCES_INTERVAL: 8000, // cada 8s para re-verificar instancias
  MIN_POLL_INTERVAL: 3000,         // polling rápido (3s)
  MAX_POLL_INTERVAL: 15000,        // polling lento (15s)

  // Lógica de envío
  MAX_MESSAGES_PER_INSTANCE: 7,

  // Pausas (puedes ajustar para “menos spam”)
  MESSAGE_INTERVAL_MIN: 2000,  // 2s
  MESSAGE_INTERVAL_MAX: 5000,  // 5s

  EXTENDED_PAUSE_PROBABILITY: 0.2,
  EXTENDED_PAUSE_MIN: 8000,    // 8s
  EXTENDED_PAUSE_MAX: 20000,   // 20s

  OCCASIONAL_BREAK_PROBABILITY: 0.05,
  OCCASIONAL_BREAK_MIN: 20000, // 20s
  OCCASIONAL_BREAK_MAX: 60000, // 1min

  // Reintentos
  RETRY_DELAY_MIN: 3000, // 3s
  RETRY_DELAY_MAX: 8000, // 8s
  MAX_RETRIES: 3,

  // APIs
  QUEUE_API_URL: 'http://188.245.38.255:5000/api/sendwhatsapp/colaenvio/?empresa=yego',
  CONFIRMATION_API_URL: 'http://188.245.38.255:5000/api/sendwhatsapp/envio',
  INSTANCES_API_URL: 'http://localhost:5000/api/instances',
  SEND_MESSAGE_API_BASE_URL: 'https://apievo.3w.pe/message/sendText/',

  // Persistencia
  SENT_MESSAGES_FILE: path.join(__dirname, 'sentMessages.json'),
  LOG_ENCODING: 'utf8',
};

/****************************************************
 * SCHEMA DE VALIDACIÓN
 ****************************************************/
const messageSchema = Joi.object({
  idSendmessage: Joi.number().required(),
  tenvio: Joi.string().required(),
  mensaje: Joi.string().required(),
}).unknown(true); 
// .unknown(true) => acepta campos extra como "campania", "tipo", etc.

/****************************************************
 * VARIABLES GLOBALES
 ****************************************************/
let activeInstances = [];     // Instancias “open”
let sentMessages = new Set(); // ID de mensajes que ya se enviaron

// Conexión Redis para Bull
const redisConnection = new Redis(CONFIG.REDIS_URL);

// Cola principal con Bull
const sendQueue = new Bull('sendQueue', {
  redis: CONFIG.REDIS_URL,
  defaultJobOptions: {
    removeOnComplete: 5000,
    removeOnFail: 5000,
  },
});

// Stats por instancia
const instanceStats = {};

// IDs que siguen vigentes en la API
let remoteValidIds = new Set();

/****************************************************
 * FUNCIONES DE UTILIDAD (PAUSAS, TIPEO, ETC.)
 ****************************************************/
function getRandomTime(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function simulateTypingTime(message) {
  const words = (message || '').split(' ').length;
  // Ajusta a tu gusto
  const readingTime = getRandomTime(1000, 2000);
  const writingTime = getRandomTime(1500, 3000) + words * getRandomTime(50, 100);
  return readingTime + writingTime;
}

function getExtendedPauseTime() {
  if (Math.random() < CONFIG.EXTENDED_PAUSE_PROBABILITY) {
    return getRandomTime(CONFIG.EXTENDED_PAUSE_MIN, CONFIG.EXTENDED_PAUSE_MAX);
  }
  return getRandomTime(CONFIG.MESSAGE_INTERVAL_MIN, CONFIG.MESSAGE_INTERVAL_MAX);
}

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
      // Si no existe, lo creamos vacío
      await fs.writeFile(
        CONFIG.SENT_MESSAGES_FILE,
        JSON.stringify([], null, 2),
        CONFIG.LOG_ENCODING
      );
      sentMessages = new Set();
      logger.info('✅ Archivo de mensajes enviados creado.');
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
 * POLLING ADAPTATIVO DE LA COLA
 ****************************************************/
let currentPollInterval = CONFIG.MIN_POLL_INTERVAL;
let pollTimeout = null;

/**
 * updateLocalQueueFromRemote:
 * 1) Obtiene la lista COMPLETA de mensajes vigentes (si hay).
 * 2) Encolamos los nuevos (si no están en sentMessages ni en Bull).
 * 3) Eliminamos de la cola local los que ya no estén en la lista de IDs vigentes.
 */
async function updateLocalQueueFromRemote() {
  try {
    logger.debug(`🔄 Polling adaptativo: consultando cola...`);
    const response = await axios.get(CONFIG.QUEUE_API_URL);

    // Caso “No hay registros”
    if (response.data?.message?.includes('No hay registros')) {
      logger.debug(`📭 (API) No hay registros devueltos.`);
      remoteValidIds = new Set();
      currentPollInterval = Math.min(currentPollInterval * 1.5, CONFIG.MAX_POLL_INTERVAL);
      // Eliminar todo lo “waiting/delayed” porque la API dice que no hay nada
      await removeNonExistingJobs(remoteValidIds);
      return;
    }

    // Determinar si es array o un solo objeto
    let incoming = [];
    if (Array.isArray(response.data)) {
      incoming = response.data;
    } else {
      incoming = [response.data];
    }

    const newRemoteIds = new Set();
    let newCount = 0;

    for (const rawMsg of incoming) {
      logger.debug(`DEBUG => Mensaje crudo de la API => ${JSON.stringify(rawMsg)}`);

      // Validar con Joi
      const { error, value } = messageSchema.validate(rawMsg);
      if (error) {
        logger.warn(`❌ Mensaje inválido => ${error.message}, data=${JSON.stringify(rawMsg)}`);
        continue;
      }

      // Actualizar set
      newRemoteIds.add(value.idSendmessage);

      // Checar si ya está enviado
      if (sentMessages.has(value.idSendmessage)) {
        logger.debug(`SKIP => idSendmessage=${value.idSendmessage} ya está en sentMessages.`);
        continue;
      }

      // Revisar si ya está en Bull con un jobId (para no duplicar)
      const jobId = `msg-${value.idSendmessage}`;
      const existingJob = await sendQueue.getJob(jobId);
      if (existingJob) {
        logger.debug(`SKIP => idSendmessage=${value.idSendmessage} ya existe jobId=${jobId} en Bull.`);
        continue;
      }

      // Si llegamos aquí => es un mensaje NUEVO para encolar
      logger.info(`📬 Nuevo msg id=${value.idSendmessage}, encolándolo en Bull.`);
      await sendQueue.add(value, { jobId });
      newCount++;
    }

    remoteValidIds = newRemoteIds; // Actualizamos la lista de vigentes

    if (newCount > 0) {
      logger.info(`📬 Se encolaron ${newCount} mensajes nuevos.`);
      currentPollInterval = CONFIG.MIN_POLL_INTERVAL;
    } else {
      logger.debug(`No se encontraron mensajes nuevos para encolar.`);
      currentPollInterval = Math.min(currentPollInterval * 1.2, CONFIG.MAX_POLL_INTERVAL);
    }

    // Eliminar los jobs locales que ya NO estén en la API
    await removeNonExistingJobs(remoteValidIds);
  } catch (err) {
    logger.error(`⚠️ Error en updateLocalQueueFromRemote: ${err.message}`);
    currentPollInterval = 10000;
  } finally {
    pollTimeout = setTimeout(updateLocalQueueFromRemote, currentPollInterval);
  }
}

/**
 * removeNonExistingJobs:
 * - mira los jobs “waiting” y “delayed” en Bull
 * - si su ID no está en remoteIds => se remueven
 */
async function removeNonExistingJobs(remoteIds) {
  const jobsInQueue = await sendQueue.getJobs(['waiting', 'delayed']);
  let removedCount = 0;
  for (const job of jobsInQueue) {
    const data = job.data;
    if (!remoteIds.has(data.idSendmessage)) {
      logger.debug(`🗑️ Eliminando job#${job.id} => id=${data.idSendmessage}, ya no está en la API.`);
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
    logger.debug('🔍 Consultando instancias activas...');
    const resp = await axios.get(CONFIG.INSTANCES_API_URL);
    const openOnes = resp.data.filter((i) => i.connectionStatus === 'open');
    if (!openOnes.length) {
      logger.warn('⚪ No se encontraron instancias activas.');
      activeInstances = [];
      return;
    }
    activeInstances = openOnes.map((i) => ({
      name: i.name,
      token: i.token,
    }));
    logger.debug(`🟢 Instancias activas: ${activeInstances.map((i) => i.name).join(', ')}`);
  } catch (error) {
    logger.error(`⚠️ Error al obtener instancias: ${error.message}`);
    activeInstances = [];
  }
}

/**
 * getAvailableInstance
 * - Escoge la instancia con menos “count” (para balancear)
 */
function getAvailableInstance() {
  const candidates = activeInstances.map((inst) => {
    const st = instanceStats[inst.name] || { count: 0 };
    return { ...inst, ...st };
  });
  if (!candidates.length) return null;
  // Ordenar asc por “count”
  candidates.sort((a, b) => (a.count || 0) - (b.count || 0));
  return candidates[0];
}

/****************************************************
 * PROCESADOR DE BULL
 ****************************************************/
// concurrency=3 => hasta 3 en paralelo
sendQueue.process(3, async (job) => {
  const data = job.data;
  logger.debug(`🔧 Procesando job#${job.id} => ${JSON.stringify(data)}`);

  // Chequeo final: ¿Sigue el ID en la cola remota?
  if (!remoteValidIds.has(data.idSendmessage)) {
    logger.warn(
      `⚠️ job#${job.id} => id=${data.idSendmessage} ya no está en la API. Cancelando envío.`
    );
    return;
  }

  // Ya se envió en disco?
  if (sentMessages.has(data.idSendmessage)) {
    logger.warn(
      `⚠️ job#${job.id} => id=${data.idSendmessage} ya está en sentMessages. Abortando.`
    );
    return;
  }

  // Buscar instancia
  const inst = getAvailableInstance();
  if (!inst) {
    logger.warn(`⚠️ job#${job.id} => No hay instancias disponibles. Reintentando luego.`);
    throw new Error('No instance available');
  }

  if (!instanceStats[inst.name]) {
    instanceStats[inst.name] = { count: 0 };
  }

  // Si la instancia llegó al límite => pausa
  if (instanceStats[inst.name].count >= CONFIG.MAX_MESSAGES_PER_INSTANCE) {
    const bigBreak = simulateOccasionalBreak();
    if (bigBreak > 0) {
      logger.info(
        `🛑 [${inst.name}] Pausa ocasional de ${(bigBreak / 1000).toFixed(2)}s (límite msgs).`
      );
      await new Promise((r) => setTimeout(r, bigBreak));
      instanceStats[inst.name].count = 0;
    } else {
      const pauseTime = getExtendedPauseTime();
      logger.info(
        `⏳ [${inst.name}] Pausa de ${(pauseTime / 1000).toFixed(2)}s (límite msgs).`
      );
      await new Promise((r) => setTimeout(r, pauseTime));
      instanceStats[inst.name].count = 0;
    }
  }

  // Simular tipeo
  const typingDelay = simulateTypingTime(data.mensaje);
  logger.info(`⌨️ [${inst.name}] Tipeo de ${typingDelay}ms para id=${data.idSendmessage}`);
  await new Promise((r) => setTimeout(r, typingDelay));

  logger.info(`📤 [${inst.name}] Enviando id=${data.idSendmessage} a ${data.tenvio}`);
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

    logger.info(`✅ [${inst.name}] Respuesta => ${resp.status} para id=${data.idSendmessage}`);

    if (resp.status === 200 || resp.status === 201) {
      // Marcamos como enviado
      sentMessages.add(data.idSendmessage);
      await saveSentMessages();
    }

    // Confirmamos
    await confirmMessageSend(resp.status, data.idSendmessage, inst.name);

    // Aumentar conteo
    instanceStats[inst.name].count = (instanceStats[inst.name].count || 0) + 1;

    // Pausa final
    const waitTime = getExtendedPauseTime();
    logger.info(`⏳ [${inst.name}] Espera de ${(waitTime / 1000).toFixed(2)}s tras enviar.`);
    await new Promise((r) => setTimeout(r, waitTime));

  } catch (err) {
    logger.error(`❌ [${inst.name}] Error enviando id=${data.idSendmessage} => ${err.message}`);

    if (err.response?.status === 400) {
      logger.warn(`⚠️ [${inst.name}] 400 => no reintentar. Confirmando como fallo.`);
      await confirmMessageSend(400, data.idSendmessage, inst.name);
      return;
    }
    // Cualquier otro error => throw para reintentar
    throw err;
  }
});

/**
 * Manejo de fallas (reintentos) en Bull
 */
sendQueue.on('failed', async (job, err) => {
  const attemptsMade = job.attemptsMade || 1;
  logger.warn(`🔴 Job#${job.id} falló (intento ${attemptsMade}): ${err.message}`);
  if (attemptsMade >= CONFIG.MAX_RETRIES) {
    logger.error(`❌ Job#${job.id} agotó reintentos (${CONFIG.MAX_RETRIES}).`);
  } else {
    // Reintento con un backoff
    const retryDelay = getRandomTime(CONFIG.RETRY_DELAY_MIN, CONFIG.RETRY_DELAY_MAX);
    job.opts.backoff = { type: 'fixed', delay: retryDelay };
  }
});

/****************************************************
 * CONFIRMACIÓN DE ENVÍO
 ****************************************************/
async function confirmMessageSend(statusCode, id, instanceName) {
  const cenvio = (statusCode === 200 || statusCode === 201) ? 1 : 2;
  try {
    const resp = await axios.post(CONFIG.CONFIRMATION_API_URL, {
      Idenvio: id,
      Ninstancia: instanceName,
      Cenvio: cenvio,
    });
    logger.debug(`Confirmación id=${id} cenvio=${cenvio}, respuesta=${resp.status}`);
  } catch (err) {
    logger.error(`⚠️ Error al confirmar envío id=${id} => ${err.message}`);
  }
}

/****************************************************
 * INICIALIZACIÓN
 ****************************************************/
async function init() {
  // 1) Cargar sentMessages
  await loadSentMessages();

  // 2) Iniciar polling adaptativo
  updateLocalQueueFromRemote();

  // 3) Iniciar polling de instancias
  updateActiveInstances();
  setInterval(updateActiveInstances, CONFIG.POLLING_INSTANCES_INTERVAL);

  // 4) Configurar reintentos globales
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
