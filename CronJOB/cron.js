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
// Con level='info' veremos pocos logs, 
// pero al menos uno por cada polling (para saber que sigue vivo).
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
  REDIS_URL: 'redis://127.0.0.1:6379',

  // Polling
  POLLING_INSTANCES_INTERVAL: 8000, // cada 8s re-verificamos instancias
  MIN_POLL_INTERVAL: 3000,         // poll rápido (3s)
  MAX_POLL_INTERVAL: 15000,        // poll lento (15s)

  // Lógica de envío
  MAX_MESSAGES_PER_INSTANCE: 7,

  // Pausas
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

/****************************************************
 * VARIABLES GLOBALES
 ****************************************************/
let activeInstances = [];
let sentMessages = new Set();

// Conexión Redis
const redisConnection = new Redis(CONFIG.REDIS_URL);

// Cola de Bull
const sendQueue = new Bull('sendQueue', {
  redis: CONFIG.REDIS_URL,
  defaultJobOptions: {
    removeOnComplete: 5000,
    removeOnFail: 5000,
  },
});

// Stats por instancia
const instanceStats = {};

// IDs vigentes en la API (los que aún no se eliminan)
let remoteValidIds = new Set();

/****************************************************
 * FUNCIONES DE UTILIDAD
 ****************************************************/
function getRandomTime(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function simulateTypingTime(message) {
  const words = (message || '').split(' ').length;
  const reading = getRandomTime(1000, 2000);
  const writing = getRandomTime(1500, 3000) + words * getRandomTime(50, 100);
  return reading + writing;
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
 * PERSISTENCIA DE MENSAJES (ID ya enviados)
 ****************************************************/
async function loadSentMessages() {
  try {
    const data = await fs.readFile(CONFIG.SENT_MESSAGES_FILE, CONFIG.LOG_ENCODING);
    const parsed = JSON.parse(data);
    sentMessages = new Set(parsed);
    logger.info(`✅ Cargados ${sentMessages.size} mensajes previamente enviados.`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.writeFile(
        CONFIG.SENT_MESSAGES_FILE,
        JSON.stringify([], null, 2),
        CONFIG.LOG_ENCODING
      );
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
 * POLLING DE LA COLA (ADAPTATIVO, CON LOGS BÁSICOS)
 ****************************************************/
let currentPollInterval = CONFIG.MIN_POLL_INTERVAL;
let pollTimeout = null;

async function updateLocalQueueFromRemote() {
  logger.info(`🔄 Polling de la cola: intentando obtener mensajes...`);
  try {
    const response = await axios.get(CONFIG.QUEUE_API_URL);

    // Caso: "No hay registros"
    if (response.data?.message?.includes('No hay registros')) {
      logger.info('📭 API => “No hay registros”');
      remoteValidIds = new Set();
      currentPollInterval = Math.min(currentPollInterval * 1.5, CONFIG.MAX_POLL_INTERVAL);
      // Limpia jobs que localmente ya no estén en la API
      await removeNonExistingJobs(remoteValidIds);
      return;
    }

    let incoming = [];
    if (Array.isArray(response.data)) {
      incoming = response.data;
    } else {
      incoming = [response.data];
    }

    const newRemoteIds = new Set();
    let newCount = 0;

    for (const rawMsg of incoming) {
      const { error, value } = messageSchema.validate(rawMsg);
      if (error) {
        // Si no cumple schema, se ignora sin log extra
        continue;
      }
      newRemoteIds.add(value.idSendmessage);

      // Ver si ya enviado
      if (sentMessages.has(value.idSendmessage)) {
        continue;
      }

      // Ver si ya hay job con jobId=msg-<id>
      const jobId = `msg-${value.idSendmessage}`;
      const existingJob = await sendQueue.getJob(jobId);
      if (existingJob) {
        // Ya existe => no duplicar
        continue;
      }

      // Encolamos
      await sendQueue.add(value, { jobId });
      newCount++;
    }

    remoteValidIds = newRemoteIds;

    if (newCount > 0) {
      logger.info(`📬 Se encolaron ${newCount} mensajes nuevos.`);
      currentPollInterval = CONFIG.MIN_POLL_INTERVAL;
    } else {
      logger.info(`📭 Cola sin nuevos mensajes. Manteniendo/ajustando poll.`);
      currentPollInterval = Math.min(currentPollInterval * 1.2, CONFIG.MAX_POLL_INTERVAL);
    }

    // Eliminar jobs que ya no están en la API
    await removeNonExistingJobs(remoteValidIds);

  } catch (err) {
    logger.error(`⚠️ Error al obtener cola: ${err.message}`);
    currentPollInterval = 10000;
  } finally {
    // Programamos el siguiente polling
    pollTimeout = setTimeout(updateLocalQueueFromRemote, currentPollInterval);
  }
}

async function removeNonExistingJobs(remoteIds) {
  const jobsInQueue = await sendQueue.getJobs(['waiting', 'delayed']);
  let removedCount = 0;
  for (const job of jobsInQueue) {
    const data = job.data;
    if (!remoteIds.has(data.idSendmessage)) {
      await job.remove();
      removedCount++;
    }
  }
  if (removedCount > 0) {
    logger.info(`🗑️ Eliminados ${removedCount} jobs obsoletos localmente (API no los muestra).`);
  }
}

/****************************************************
 * POLLING DE INSTANCIAS (CON ALGÚN LOG)
 ****************************************************/
async function updateActiveInstances() {
  logger.info('🔍 Polling de instancias...');
  try {
    const resp = await axios.get(CONFIG.INSTANCES_API_URL);
    const openOnes = resp.data.filter((i) => i.connectionStatus === 'open');
    if (!openOnes.length) {
      logger.info('❌ Sin instancias activas en la API.');
      activeInstances = [];
      return;
    }
    activeInstances = openOnes.map((i) => ({
      name: i.name,
      token: i.token,
    }));
    logger.info(`🟢 Instancias activas => ${activeInstances.map((i) => i.name).join(', ')}`);
  } catch (error) {
    logger.error(`⚠️ Error al obtener instancias: ${error.message}`);
    activeInstances = [];
  }
}

/****************************************************
 * ELECCIÓN DE INSTANCIA
 ****************************************************/
function getAvailableInstance() {
  const candidates = activeInstances.map((inst) => {
    const st = instanceStats[inst.name] || { count: 0 };
    return { ...inst, ...st };
  });
  if (!candidates.length) return null;

  // Ordenar por la que tenga menos count
  candidates.sort((a, b) => (a.count || 0) - (b.count || 0));
  return candidates[0];
}

/****************************************************
 * PROCESAMIENTO DE BULL
 ****************************************************/
sendQueue.process(3, async (job) => {
  const data = job.data;

  // si la API ya no lo considera vigente
  if (!remoteValidIds.has(data.idSendmessage)) {
    return;
  }
  // si ya se envió
  if (sentMessages.has(data.idSendmessage)) {
    return;
  }

  // buscar instancia
  const inst = getAvailableInstance();
  if (!inst) {
    // no hay instancias
    throw new Error('No instance available');
  }
  if (!instanceStats[inst.name]) {
    instanceStats[inst.name] = { count: 0 };
  }

  // Si alcanzó máximo
  if (instanceStats[inst.name].count >= CONFIG.MAX_MESSAGES_PER_INSTANCE) {
    const bigBreak = simulateOccasionalBreak();
    if (bigBreak > 0) {
      await new Promise((r) => setTimeout(r, bigBreak));
      instanceStats[inst.name].count = 0;
    } else {
      const pauseTime = getExtendedPauseTime();
      await new Promise((r) => setTimeout(r, pauseTime));
      instanceStats[inst.name].count = 0;
    }
  }

  // Tipeo
  const typingDelay = simulateTypingTime(data.mensaje);
  await new Promise((r) => setTimeout(r, typingDelay));

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
      sentMessages.add(data.idSendmessage);
      await saveSentMessages();
    }
    await confirmMessageSend(resp.status, data.idSendmessage, inst.name);

    instanceStats[inst.name].count = (instanceStats[inst.name].count || 0) + 1;

    // Pausa final
    const waitTime = getExtendedPauseTime();
    await new Promise((r) => setTimeout(r, waitTime));

  } catch (err) {
    // Si 400 => no reintento
    if (err.response?.status === 400) {
      await confirmMessageSend(400, data.idSendmessage, inst.name);
      return;
    }
    throw err; // reintentar
  }
});

sendQueue.on('failed', async (job, err) => {
  const attemptsMade = job.attemptsMade || 1;
  if (attemptsMade >= CONFIG.MAX_RETRIES) {
    logger.error(`❌ Job#${job.id} agotó reintentos => ${err.message}`);
  } else {
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
    await axios.post(CONFIG.CONFIRMATION_API_URL, {
      Idenvio: id,
      Ninstancia: instanceName,
      Cenvio: cenvio,
    });
  } catch (err) {
    logger.error(`⚠️ Error al confirmar #${id}: ${err.message}`);
  }
}

/****************************************************
 * INICIALIZACIÓN
 ****************************************************/
async function init() {
  // cargar IDs ya enviados
  await loadSentMessages();

  // iniciar polling de la cola
  updateLocalQueueFromRemote();

  // iniciar polling de instancias
  updateActiveInstances();
  setInterval(updateActiveInstances, CONFIG.POLLING_INSTANCES_INTERVAL);

  // config reintentos globales
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
  logger.error(`Unhandled Rejection => ${reason}`);
});
process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception => ${error.message}`);
  process.exit(1);
});
