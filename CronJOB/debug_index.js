/****************************************************
 * DEPENDENCIAS
 ****************************************************/
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const Redis = require('ioredis');
const Bull = require('bull');
const winston = require('winston');
// const Joi = require('joi'); // <-- Comentado (para no validar nada)

/****************************************************
 * LOGS (WINSTON)
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
 * CONFIG
 ****************************************************/
const CONFIG = {
  // Redis
  REDIS_URL: 'redis://127.0.0.1:6379',

  // API URLs (ajusta a tu entorno)
  QUEUE_API_URL: 'http://188.245.38.255:5000/api/sendwhatsapp/colaenvio/?empresa=yego',
  CONFIRMATION_API_URL: 'http://188.245.38.255:5000/api/sendwhatsapp/envio',
  INSTANCES_API_URL: 'http://localhost:5000/api/instances',
  SEND_MESSAGE_API_BASE_URL: 'https://apievo.3w.pe/message/sendText/',

  // Intervalos
  POLLING_INSTANCES_INTERVAL: 5000,
  MIN_POLL_INTERVAL: 3000,
  MAX_POLL_INTERVAL: 15000,

  // Pausas mínimas para enviar (bajamos bastante)
  MESSAGE_INTERVAL_MIN: 2000,
  MESSAGE_INTERVAL_MAX: 5000,

  EXTENDED_PAUSE_PROBABILITY: 0.1,
  EXTENDED_PAUSE_MIN: 5000,
  EXTENDED_PAUSE_MAX: 10000,

  OCCASIONAL_BREAK_PROBABILITY: 0.05,
  OCCASIONAL_BREAK_MIN: 10000,
  OCCASIONAL_BREAK_MAX: 30000,

  MAX_RETRIES: 3,

  // En este modo de debug, ni siquiera usaremos la persistencia:
  // SENT_MESSAGES_FILE: path.join(__dirname, 'sentMessages.json'),
};

/****************************************************
 * REDIS / BULL
 ****************************************************/
const redisConnection = new Redis(CONFIG.REDIS_URL);
const sendQueue = new Bull('debugSendQueue', {
  redis: CONFIG.REDIS_URL,
  defaultJobOptions: {
    removeOnComplete: 500,
    removeOnFail: 500,
  },
});

/****************************************************
 * VARIABLES GLOBALES
 ****************************************************/
// No guardaremos ya_enviados para debug
// let sentMessages = new Set(); 
let activeInstances = [];

/****************************************************
 * FUNCIONES DE UTILIDAD
 ****************************************************/
function getRandomTime(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function simulateTypingTime(msg) {
  const words = (msg || '').split(' ').length;
  const reading = getRandomTime(500, 1000);
  const writing = getRandomTime(1000, 2000) + words * getRandomTime(30, 50);
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
 * POLLING DE LA COLA (SIN VALIDACIONES)
 ****************************************************/
let currentPollInterval = CONFIG.MIN_POLL_INTERVAL;
let pollTimeout = null;

async function debugFetchQueue() {
  try {
    logger.info('🔄 (DEBUG) Consultando cola...');
    const response = await axios.get(CONFIG.QUEUE_API_URL);

    // Supongamos que la API te devuelve un array con
    // { idSendmessage, tenvio, mensaje, ... }
    // O un objeto con "message": "No hay registros"

    // Si se detecta "No hay registros"
    if (response.data?.message?.includes('No hay registros')) {
      logger.info('(DEBUG) No hay registros (API)');
      currentPollInterval = Math.min(currentPollInterval * 1.5, CONFIG.MAX_POLL_INTERVAL);
      return;
    }

    let incoming = [];
    if (Array.isArray(response.data)) {
      incoming = response.data;
    } else {
      incoming = [response.data];
    }

    let newCount = 0;

    for (const rawMsg of incoming) {
      // (DEBUG) Imprimir todo lo que llega
      logger.info(`(DEBUG) Llega => ${JSON.stringify(rawMsg)}`);

      // En este modo de debug NO verificamos "sentMessages"
      // NO chequeamos "existingJob"
      // NO validamos con Joi
      // Encolamos TODO directamente

      await sendQueue.add(rawMsg);
      newCount++;
    }

    if (newCount > 0) {
      logger.info(`(DEBUG) Se encolaron ${newCount} mensajes (sin filtros).`);
      currentPollInterval = CONFIG.MIN_POLL_INTERVAL;
    } else {
      logger.info('(DEBUG) No hay mensajes nuevos (quizá repetidos?).');
      currentPollInterval = Math.min(currentPollInterval * 1.2, CONFIG.MAX_POLL_INTERVAL);
    }

  } catch (err) {
    logger.error(`(DEBUG) Error al obtener cola: ${err.message}`);
    currentPollInterval = 10000;
  } finally {
    pollTimeout = setTimeout(debugFetchQueue, currentPollInterval);
  }
}

/****************************************************
 * POLLING DE INSTANCIAS (SIN MUCHA LÓGICA)
 ****************************************************/
async function debugUpdateInstances() {
  try {
    logger.info('(DEBUG) Consultando instancias...');
    const resp = await axios.get(CONFIG.INSTANCES_API_URL);
    const openOnes = resp.data.filter(i => i.connectionStatus === 'open');
    if (!openOnes.length) {
      logger.warn('(DEBUG) Ninguna instancia activa.');
      activeInstances = [];
    } else {
      activeInstances = openOnes.map(i => ({
        name: i.name,
        token: i.token,
      }));
      logger.info(
        `(DEBUG) Instancias activas => ${activeInstances.map(i => i.name).join(', ')}`
      );
    }
  } catch (error) {
    logger.error(`(DEBUG) Error al obtener instancias => ${error.message}`);
    activeInstances = [];
  }
}

function getAnyInstance() {
  return activeInstances.length ? activeInstances[0] : null;
}

/****************************************************
 * PROCESADOR DE JOBS (SIN DESCARTES)
 ****************************************************/
sendQueue.process(3, async (job) => {
  // Recibe la data exacta que encolamos
  const data = job.data;
  logger.info(`(DEBUG) Procesando job#${job.id} => ${JSON.stringify(data)}`);

  // Revisar si hay instancias
  const inst = getAnyInstance();
  if (!inst) {
    logger.warn('(DEBUG) No hay instancias disponibles => fallo forzado');
    throw new Error('No instance available');
  }

  // Simular tipeo (más corto)
  const typing = simulateTypingTime(data.mensaje || '');
  logger.info(`(DEBUG) [${inst.name}] Tipeo de ${typing}ms`);
  await new Promise(r => setTimeout(r, typing));

  logger.info(`(DEBUG) [${inst.name}] Enviando a ${data.tenvio} (id=${data.idSendmessage})`);
  try {
    // Realizamos POST
    const resp = await axios.post(
      `${CONFIG.SEND_MESSAGE_API_BASE_URL}${inst.name}`,
      {
        number: data.tenvio,
        text: data.mensaje || '(sin mensaje)',
      },
      {
        headers: { Apikey: inst.token },
        timeout: 30000,
      }
    );

    logger.info(`(DEBUG) [${inst.name}] Respuesta => ${resp.status}`);
    // No confirmamos ni guardamos en "sentMessages" en este debug

    // Pausa final
    const wait = getExtendedPauseTime();
    logger.info(`(DEBUG) [${inst.name}] Pausa de ${wait}ms tras enviar`);
    await new Promise(r => setTimeout(r, wait));

    return 'OK';
  } catch (err) {
    logger.error(`(DEBUG) [${inst.name}] Error => ${err.message}`);
    // Si es 400 => no reintentar
    if (err.response?.status === 400) {
      logger.warn('(DEBUG) 400 => Sin reintentos');
      return;
    }
    throw err;
  }
});

// Manejo de fallos
sendQueue.on('failed', (job, err) => {
  logger.warn(`(DEBUG) Job#${job.id} fallo => ${err.message}, intento=${job.attemptsMade}`);
});

/****************************************************
 * INICIALIZACIÓN
 ****************************************************/
async function initDebug() {
  logger.info('=== [DEBUG] Iniciando sistema con validaciones DESACTIVADAS ===');

  // Iniciar polling de cola
  debugFetchQueue();

  // Iniciar polling de instancias
  debugUpdateInstances();
  setInterval(debugUpdateInstances, CONFIG.POLLING_INSTANCES_INTERVAL);
  
  logger.info('=== [DEBUG] Listo. Ver logs para ver si llegan mensajes ===');
}

initDebug().catch((err) => {
  logger.error(`(DEBUG) Error crítico => ${err.message}`);
  process.exit(1);
});

/****************************************************
 * ERRORES GLOBALES
 ****************************************************/
process.on('unhandledRejection', (reason, promise) => {
  logger.error(`(DEBUG) Unhandled Rejection => ${promise}, reason => ${reason}`);
});
process.on('uncaughtException', (error) => {
  logger.error(`(DEBUG) Uncaught Exception => ${error.message}`);
  process.exit(1);
});
