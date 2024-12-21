/************************************
 * DEPENDENCIAS
 ************************************/
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const Joi = require('joi');

/************************************
 * CONFIGURACIÓN DE LOG
 ************************************/
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

/************************************
 * CONFIGURACIÓN DE LA APP
 ************************************/
const CONFIG = {
  // Límite de mensajes por "ciclo" para cada instancia
  MAX_MESSAGES_PER_INSTANCE: 7,

  // Intervalos de pausa estándar (en ms)
  MESSAGE_INTERVAL_MIN: 20_000,  // 20s
  MESSAGE_INTERVAL_MAX: 60_000,  // 1m

  // Pausa extendida
  EXTENDED_PAUSE_PROBABILITY: 0.25,
  EXTENDED_PAUSE_MIN: 60_000,    // 1m
  EXTENDED_PAUSE_MAX: 180_000,   // 3m

  // Pausa ocasional larga
  OCCASIONAL_BREAK_PROBABILITY: 0.10,
  OCCASIONAL_BREAK_MIN: 120_000, // 2m
  OCCASIONAL_BREAK_MAX: 300_000, // 5m

  // Retrasos para reintentos
  RETRY_DELAY_MIN: 30_000,       // 30s
  RETRY_DELAY_MAX: 120_000,      // 2m

  // Rutas a APIs
  QUEUE_API_URL: 'http://188.245.38.255:5000/api/sendwhatsapp/colaenvio/?empresa=yego',
  CONFIRMATION_API_URL: 'http://188.245.38.255:5000/api/sendwhatsapp/envio',
  INSTANCES_API_URL: 'http://localhost:5000/api/instances',
  SEND_MESSAGE_API_BASE_URL: 'https://apievo.3w.pe/message/sendText/',

  // Archivo de persistencia
  SENT_MESSAGES_FILE: path.join(__dirname, 'sentMessages.json'),
  LOG_ENCODING: 'utf8',

  // Límite de reintentos
  MAX_RETRIES: 3,

  // Polling principal (más frecuente)
  POLLING_INSTANCES_INTERVAL: 15_000, // 15s, para chequear instancias
  POLLING_QUEUE_INTERVAL: 15_000,     // 15s, para chequear cola

  // Espera cuando la instancia no encuentra mensajes inmediatamente
  POLLING_MESSAGE_INTERVAL: 5_000,    // 5s
};

/************************************
 * SCHEMA DE VALIDACIÓN
 ************************************/
const messageSchema = Joi.object({
  idSendmessage: Joi.number().required(),
  tenvio: Joi.string().required(),
  mensaje: Joi.string().required(),
}).unknown(true);

/************************************
 * VARIABLES GLOBALES
 ************************************/

// Lista de instancias activas (cada objeto = { name, token, messagesSentCount, etc. })
let instances = [];

// Cola de mensajes global en memoria
let messageQueue = [];

// Control de duplicados
const inProgressMessages = new Set();  // mensajes que se están enviando
let sentMessages = new Set();          // mensajes ya enviados (persistidos en disco)

// Flags de vida para cada instancia
const instanceFlags = {};  // { [instanceName]: { active: boolean } }

/************************************
 * FUNCIONES DE UTILIDAD
 ************************************/

function getRandomTime(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getExtendedRandomTime() {
  const randomChance = Math.random();
  if (randomChance < CONFIG.EXTENDED_PAUSE_PROBABILITY) {
    // Pausa extendida
    return getRandomTime(CONFIG.EXTENDED_PAUSE_MIN, CONFIG.EXTENDED_PAUSE_MAX);
  }
  // Pausa "normal"
  return getRandomTime(CONFIG.MESSAGE_INTERVAL_MIN, CONFIG.MESSAGE_INTERVAL_MAX);
}

function simulateOccasionalBreak() {
  const chance = Math.random();
  if (chance < CONFIG.OCCASIONAL_BREAK_PROBABILITY) {
    const longBreak = getRandomTime(CONFIG.OCCASIONAL_BREAK_MIN, CONFIG.OCCASIONAL_BREAK_MAX);
    logger.info(
      `🛑 Tomando una pausa de ${(longBreak / 1000 / 60).toFixed(
        2
      )} minutos para evitar detección.`
    );
    return longBreak;
  }
  return 0;
}

/**
 * Simula tiempo de tecleo basado en la longitud del mensaje.
 * @param {string} message 
 * @returns {number} Tiempo en ms
 */
function simulateTypingTime(message) {
  if (!message) return 0;
  const words = message.split(' ').length;
  const readingTime = getRandomTime(2000, 4000);
  const writingTime = getRandomTime(3000, 6000) + words * getRandomTime(80, 200);
  return readingTime + writingTime;
}

/************************************
 * PERSISTENCIA DE MENSAJES ENVIADOS
 ************************************/
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
      logger.info('✅ Archivo de mensajes enviados creado (estaba inexistente).');
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

/************************************
 * GESTIÓN DE MENSAJES
 ************************************/

/**
 * Consulta la cola de mensajes y la actualiza en `messageQueue`.
 * Se llama periódicamente con setInterval.
 */
async function fetchMessageQueue() {
  try {
    logger.info('🔄 Actualizando la cola de mensajes...');
    const response = await axios.get(CONFIG.QUEUE_API_URL);

    // Manejo de "No hay registros"
    if (response.data?.message?.includes("No hay registros")) {
      logger.info('📭 No hay mensajes en la cola.');
      messageQueue = [];
      return;
    }

    let incomingMessages = [];
    if (Array.isArray(response.data)) {
      incomingMessages = response.data;
    } else {
      // Por si la API devuelve un solo objeto en lugar de array
      incomingMessages = [response.data];
    }

    const apiMessageIds = new Set();
    const newMessages = [];

    for (const msg of incomingMessages) {
      // Validación del schema
      const { error, value } = messageSchema.validate(msg);
      if (error) {
        logger.error(
          `❌ Mensaje con estructura inválida: ${error.message}. Datos: ${JSON.stringify(msg)}`
        );
        continue;
      }

      apiMessageIds.add(value.idSendmessage);

      if (inProgressMessages.has(value.idSendmessage)) {
        logger.debug(`Mensaje ${value.idSendmessage} ignorado: ya en progreso`);
        continue;
      }
      if (sentMessages.has(value.idSendmessage)) {
        logger.debug(`Mensaje ${value.idSendmessage} ignorado: ya enviado anteriormente`);
        continue;
      }

      // Si pasa todas las validaciones, lo agregamos
      newMessages.push(value);
    }

    if (newMessages.length > 0) {
      logger.info(`📬 Se agregaron ${newMessages.length} nuevos mensajes a la cola.`);
      messageQueue.push(...newMessages);
    } else {
      logger.info('📭 No hay nuevos mensajes para agregar a la cola.');
    }

    // Limpiar de la cola local los mensajes que ya no estén en la API
    const beforeLength = messageQueue.length;
    messageQueue = messageQueue.filter((m) => apiMessageIds.has(m.idSendmessage));
    const afterLength = messageQueue.length;
    if (beforeLength !== afterLength) {
      logger.info(
        `🗑️ Se eliminaron ${beforeLength - afterLength} mensajes obsoletos de la cola local.`
      );
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      logger.info('📭 No hay mensajes en la cola (Error 404).');
      messageQueue = [];
    } else {
      logger.error(`⚠️ Error al obtener la cola de envío: ${error.message}`);
    }
  }
}

/**
 * Extrae un mensaje de la cola en memoria. 
 * Retorna `null` si no hay mensajes.
 */
function getNextQueueMessage() {
  if (messageQueue.length === 0) {
    return null;
  }
  return messageQueue.shift();
}

/************************************
 * GESTIÓN DE INSTANCIAS
 ************************************/

/**
 * Consulta el endpoint de instancias activas y actualiza la lista global `instances`.
 * También gestiona iniciar o detener el bucle de envío por instancia.
 */
async function getActiveInstances() {
  try {
    logger.info('🔍 Consultando instancias activas...');
    const response = await axios.get(CONFIG.INSTANCES_API_URL);

    // Filtramos las que estén "open"
    const activeInstances = response.data.filter((instance) => instance.connectionStatus === 'open');
    if (activeInstances.length > 0) {
      logger.info(
        `🟢 Instancias activas encontradas: ${activeInstances.map((i) => i.name).join(', ')}`
      );
    } else {
      logger.warn('⚪ No se encontraron instancias activas.');
    }

    // Determinamos cuáles son nuevas y cuáles se desconectaron
    const activeNames = activeInstances.map((i) => i.name);
    const oldNames = instances.map((i) => i.name);

    const newInstances = activeInstances.filter((i) => !oldNames.includes(i.name));
    const disconnected = instances.filter((i) => !activeNames.includes(i.name));

    // Actualizamos la lista de instancias
    instances = activeInstances.map((instance) => ({
      name: instance.name,
      ownerJid: instance.ownerJid,
      token: instance.token,
      messagesSentCount: instance.messagesSentCount || 0,
      isPaused: instance.isPaused || false,
    }));

    // Iniciar envío para nuevas instancias
    for (const inst of newInstances) {
      if (!instanceFlags[inst.name]) {
        instanceFlags[inst.name] = { active: true };
        manageInstanceSending(inst, instanceFlags[inst.name]).catch((err) => {
          logger.error(`🔴 Error en manageInstanceSending para ${inst.name}: ${err.message}`);
        });
      }
    }

    // Detener envío para las desconectadas
    for (const inst of disconnected) {
      if (instanceFlags[inst.name]) {
        instanceFlags[inst.name].active = false;
        logger.info(`🛑 Deteniendo envío de mensajes para la instancia ${inst.name} (desconexión).`);
      }
    }
  } catch (error) {
    logger.error(`⚠️ Error al obtener instancias: ${error.message}`);
    instances = [];
  }
}

/************************************
 * PROCESO DE ENVÍO
 ************************************/

/**
 * Enviar un mensaje a través de la instancia.
 * Incluye reintentos y confirmación de envío.
 */
async function sendMessage(instance, messageData, attempt = 1) {
  try {
    // Simular tiempo de tipeo
    const typingDelay = simulateTypingTime(messageData.mensaje);
    logger.info(`⌨️ [${instance.name}] Simulando escritura por ${(typingDelay / 1000).toFixed(2)}s...`);
    await new Promise((res) => setTimeout(res, typingDelay));

    logger.info(`📤 [${instance.name}] Enviando mensaje a ${messageData.tenvio}`);
    const response = await axios.post(
      `${CONFIG.SEND_MESSAGE_API_BASE_URL}${instance.name}`,
      {
        number: messageData.tenvio,
        text: messageData.mensaje,
      },
      {
        headers: { Apikey: instance.token },
        timeout: 30_000,
      }
    );

    // Manejo de status
    if (response.status === 200 || response.status === 201) {
      logger.info(`✅ Mensaje ${messageData.idSendmessage} enviado correctamente desde ${instance.name}`);
      sentMessages.add(messageData.idSendmessage);
      await saveSentMessages();
    } else {
      logger.warn(
        `⚠️ Mensaje ${messageData.idSendmessage} enviado con status inesperado: ${response.status}`
      );
    }

    // Confirmar envío
    await confirmMessageSend(response.status, messageData.idSendmessage, instance.name);

  } catch (error) {
    logger.error(`❌ [${instance.name}] Error al enviar msg ${messageData.idSendmessage}: ${error.message}`);

    if (error.response) {
      logger.error(
        `⚠️ Detalle del error: Status=${error.response.status}, Data=${JSON.stringify(error.response.data)}`
      );
    }

    // Si el error fue 400 => no reintentamos
    if (error.response && error.response.status === 400) {
      await confirmMessageSend(400, messageData.idSendmessage, instance.name);
      logger.warn(`⚠️ Mensaje ${messageData.idSendmessage} falló con status 400. No se reintentará.`);
      return;
    }

    // Si no fue 400, reintentamos hasta MAX_RETRIES
    if (attempt < CONFIG.MAX_RETRIES) {
      const retryDelay = getRandomTime(CONFIG.RETRY_DELAY_MIN, CONFIG.RETRY_DELAY_MAX);
      logger.warn(
        `🔄 [${instance.name}] Reintentando mensaje ${messageData.idSendmessage} en ${(retryDelay / 1000).toFixed(
          2
        )}s (Intento ${attempt + 1}/${CONFIG.MAX_RETRIES})`
      );
      await new Promise((res) => setTimeout(res, retryDelay));
      return sendMessage(instance, messageData, attempt + 1);
    } else {
      logger.error(
        `❌ [${instance.name}] Falló envío del mensaje ${messageData.idSendmessage} tras ${CONFIG.MAX_RETRIES} intentos.`
      );
    }
  } finally {
    inProgressMessages.delete(messageData.idSendmessage);
  }
}

/**
 * Confirma al API que el mensaje fue (o no) enviado correctamente.
 */
async function confirmMessageSend(statusCode, idSendmessage, instanceName) {
  // cenvio = 1 => éxito (201/200), cenvio = 2 => error
  const cenvio = (statusCode === 200 || statusCode === 201) ? 1 : 2;

  try {
    const response = await axios.post(CONFIG.CONFIRMATION_API_URL, {
      Idenvio: idSendmessage,
      Ninstancia: instanceName,
      Cenvio: cenvio,
    });
    logger.info(
      `✅ Confirmación de envío para ID ${idSendmessage} (cenvio=${cenvio}): Respuesta ${response.status}`
    );
  } catch (error) {
    logger.error(`⚠️ Error al confirmar envío de ${idSendmessage}: ${error.message}`);
  }
}

/**
 * Bucle de envío para cada instancia.
 * Mientras la instancia esté activa (`flag.active`), toma mensajes de la cola y los envía.
 */
async function manageInstanceSending(instance, flag) {
  while (flag.active) {
    const messageData = getNextQueueMessage();

    if (!messageData) {
      // No hay mensajes => esperamos un poco
      logger.info(`[${instance.name}] No hay mensajes en cola. Esperando ${CONFIG.POLLING_MESSAGE_INTERVAL / 1000}s...`);
      await new Promise((res) => setTimeout(res, CONFIG.POLLING_MESSAGE_INTERVAL));
      continue;
    }

    // Revisiones de duplicidad
    if (inProgressMessages.has(messageData.idSendmessage)) {
      logger.warn(`[${instance.name}] Msg duplicado ${messageData.idSendmessage}, saltando...`);
      continue;
    }
    if (sentMessages.has(messageData.idSendmessage)) {
      logger.warn(`[${instance.name}] Msg ${messageData.idSendmessage} ya enviado, saltando...`);
      continue;
    }

    // Revisamos si la instancia llegó al máximo de mensajes
    if (instance.messagesSentCount >= CONFIG.MAX_MESSAGES_PER_INSTANCE) {
      // Simulamos pausa ocasional
      const longBreak = simulateOccasionalBreak();
      if (longBreak > 0) {
        logger.info(`🛑 [${instance.name}] Descanso prolongado de ${(longBreak / 60000).toFixed(2)} min.`);
        instance.messagesSentCount = 0;
        await new Promise((res) => setTimeout(res, longBreak));
      } else {
        // Pausa normal
        const pauseTime = getExtendedRandomTime();
        logger.info(`⏳ [${instance.name}] Pausa de ${(pauseTime / 1000).toFixed(2)}s (límite de msg).`);
        instance.messagesSentCount = 0;
        await new Promise((res) => setTimeout(res, pauseTime));
      }
    }

    inProgressMessages.add(messageData.idSendmessage);
    await sendMessage(instance, messageData);
    instance.messagesSentCount++;

    // Espera normal tras enviar un mensaje
    const waitTime = getExtendedRandomTime();
    logger.info(`⏳ [${instance.name}] Espera de ${(waitTime / 1000).toFixed(2)}s antes del siguiente.`);
    await new Promise((res) => setTimeout(res, waitTime));
  }

  logger.info(`🛑 [${instance.name}] Se detuvo bucle de envío (desconexión).`);
}

/************************************
 * INICIALIZACIÓN PRINCIPAL
 ************************************/

/**
 * Inicializa el sistema:
 * 1) Carga mensajes enviados
 * 2) Lanza polling a la cola e instancias
 * 3) Cada instancia corre su bucle de envío
 */
async function initialize() {
  await loadSentMessages();

  // Llamada inicial (para que no esperemos al primer interval)
  await fetchMessageQueue();
  await getActiveInstances();

  // Polling periódico de cola
  setInterval(fetchMessageQueue, CONFIG.POLLING_QUEUE_INTERVAL);

  // Polling periódico de instancias
  setInterval(getActiveInstances, CONFIG.POLLING_INSTANCES_INTERVAL);

  logger.info('🚀 Sistema de envío inicializado. Esperando mensajes e instancias...');
}

/************************************
 * CAPTURA DE ERRORES GLOBALES
 ************************************/
process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.message}`);
  process.exit(1);
});

/************************************
 * EJECUCIÓN
 ************************************/
initialize().catch((error) => {
  logger.error(`🔴 Error crítico en initialize(): ${error.message}`);
  process.exit(1);
});
