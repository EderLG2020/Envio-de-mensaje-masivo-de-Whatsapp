const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const Joi = require('joi');

// Configuración de Winston para logs
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(info => `[${info.timestamp}] ${info.level.toUpperCase()}: ${info.message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'envio.log' })
    ],
    exitOnError: false,
});

const CONFIG = {
    MAX_MESSAGES_PER_INSTANCE: 7,
    MESSAGE_INTERVAL_MIN: 20000, // 20s
    MESSAGE_INTERVAL_MAX: 60000, // 1m
    EXTENDED_PAUSE_PROBABILITY: 0.25,
    EXTENDED_PAUSE_MIN: 60000, // 1m
    EXTENDED_PAUSE_MAX: 180000, // 3m
    OCCASIONAL_BREAK_PROBABILITY: 0.10,
    OCCASIONAL_BREAK_MIN: 120000, // 2m
    OCCASIONAL_BREAK_MAX: 300000, // 5m
    RETRY_DELAY_MIN: 30000, // 30s
    RETRY_DELAY_MAX: 120000, // 2m
    QUEUE_API_URL: 'http://188.245.38.255:5000/api/sendwhatsapp/colaenvio/?empresa=yego',
    CONFIRMATION_API_URL: 'http://188.245.38.255:5000/api/sendwhatsapp/envio',
    INSTANCES_API_URL: 'http://localhost:5000/api/instances',
    SEND_MESSAGE_API_BASE_URL: 'https://apievo.3w.pe/message/sendText/',
    LOG_ENCODING: 'utf8',
    MAX_RETRIES: 3,
    POLLING_INTERVAL: 60000, // 1m
    POLLING_MESSAGE_INTERVAL: 30000, // 30s
    SENT_MESSAGES_FILE: path.join(__dirname, 'sentMessages.json')
};

// Esquema de validación
const messageSchema = Joi.object({
    idSendmessage: Joi.number().required(),
    tenvio: Joi.string().required(),
    mensaje: Joi.string().required(),
}).unknown(true);

let instances = [];
let messageQueue = [];
const inProgressMessages = new Set();
let sentMessages = new Set();
const instanceFlags = {};

// Cargar mensajes enviados
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
            logger.info('✅ Archivo de mensajes enviados creado.');
        } else {
            logger.error(`⚠️ Error al cargar mensajes enviados: ${error.message}`);
            sentMessages = new Set();
        }
    }
}

// Guardar mensajes enviados
async function saveSentMessages() {
    try {
        await fs.writeFile(CONFIG.SENT_MESSAGES_FILE, JSON.stringify([...sentMessages], null, 2), CONFIG.LOG_ENCODING);
        logger.info(`✅ Guardados ${sentMessages.size} mensajes enviados en el archivo.`);
    } catch (error) {
        logger.error(`⚠️ Error al guardar mensajes enviados: ${error.message}`);
    }
}

function getRandomTime(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getExtendedRandomTime() {
    const randomChance = Math.random();
    if (randomChance < CONFIG.EXTENDED_PAUSE_PROBABILITY) {
        return getRandomTime(CONFIG.EXTENDED_PAUSE_MIN, CONFIG.EXTENDED_PAUSE_MAX);
    }
    return getRandomTime(CONFIG.MESSAGE_INTERVAL_MIN, CONFIG.MESSAGE_INTERVAL_MAX);
}

function simulateOccasionalBreak() {
    const chance = Math.random();
    if (chance < CONFIG.OCCASIONAL_BREAK_PROBABILITY) {
        const longBreak = getRandomTime(CONFIG.OCCASIONAL_BREAK_MIN, CONFIG.OCCASIONAL_BREAK_MAX);
        logger.info(`🛑 Tomando una pausa de ${(longBreak / 1000 / 60).toFixed(2)} minutos para evitar detección.`);
        return longBreak;
    }
    return 0;
}

function simulateTypingTime(message) {
    if (!message) return 0;
    const words = message.split(' ').length;
    const readingTime = getRandomTime(2000, 4000);
    const writingTime = getRandomTime(3000, 6000) + words * getRandomTime(80, 200);
    return readingTime + writingTime;
}

// Obtener instancias activas
async function getActiveInstances() {
    try {
        logger.info('🔍 Consultando instancias activas...');
        const response = await axios.get(CONFIG.INSTANCES_API_URL);
        const activeInstances = response.data.filter(instance => instance.connectionStatus === 'open');

        if (activeInstances.length > 0) {
            logger.info(`🟢 Instancias activas encontradas: ${activeInstances.map(i => i.name).join(', ')}`);
        } else {
            logger.warn('⚪ No se encontraron instancias activas.');
        }

        const activeNames = activeInstances.map(i => i.name);
        const oldNames = instances.map(i => i.name);

        const newInstances = activeInstances.filter(i => !oldNames.includes(i.name));
        const disconnected = instances.filter(i => !activeNames.includes(i.name));

        instances = activeInstances.map(instance => ({
            name: instance.name,
            ownerJid: instance.ownerJid,
            token: instance.token,
            messagesSentCount: instance.messagesSentCount || 0,
            isPaused: instance.isPaused || false
        }));

        // Iniciar envío para nuevas instancias
        for (const inst of newInstances) {
            if (!instanceFlags[inst.name]) {
                instanceFlags[inst.name] = { active: true };
                manageInstanceSending(inst, instanceFlags[inst.name]).catch(err => {
                    logger.error(`🔴 Error en manageInstanceSending para ${inst.name}: ${err.message}`);
                });
            }
        }

        // Detener envío para las desconectadas
        for (const inst of disconnected) {
            if (instanceFlags[inst.name]) {
                instanceFlags[inst.name].active = false;
                logger.info(`🛑 Deteniendo envío de mensajes para la instancia ${inst.name} por desconexión.`);
            }
        }

    } catch (error) {
        logger.error(`⚠️ Error al obtener instancias: ${error.message}`);
        instances = [];
    }
}

// Obtener cola de mensajes
async function fetchMessageQueue() {
    try {
        logger.info('🔄 Actualizando la cola de mensajes...');
        const response = await axios.get(CONFIG.QUEUE_API_URL);

        if (response.data.message && response.data.message.includes("No hay registros")) {
            logger.info('📭 No hay mensajes en la cola.');
            messageQueue = [];
            return;
        }

        let incomingMessages = [];
        if (Array.isArray(response.data)) {
            incomingMessages = response.data;
        } else {
            incomingMessages = [response.data];
        }

        const apiMessageIds = new Set();
        const newMessages = [];

        for (const msg of incomingMessages) {
            const { error, value } = messageSchema.validate(msg);
            if (error) {
                logger.error(`❌ Mensaje con estructura inválida: ${error.message}. Datos: ${JSON.stringify(msg)}`);
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

            newMessages.push(value);
        }

        if (newMessages.length > 0) {
            logger.info(`📬 Se agregaron ${newMessages.length} nuevos mensajes a la cola.`);
            messageQueue.push(...newMessages);
        } else {
            logger.info('📭 No hay nuevos mensajes para agregar a la cola.');
        }

        // Limpiar mensajes que ya no estén en la API (si la API no los devuelve más)
        const beforeLength = messageQueue.length;
        messageQueue = messageQueue.filter(m => apiMessageIds.has(m.idSendmessage));
        const afterLength = messageQueue.length;
        if (beforeLength !== afterLength) {
            logger.info(`🗑️ Se eliminaron ${beforeLength - afterLength} mensajes obsoletos de la cola local.`);
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

// Obtener siguiente mensaje de la cola
async function getNextQueueMessage() {
    if (messageQueue.length === 0) {
        return null;
    }
    return messageQueue.shift();
}

// Enviar mensaje con reintentos
async function sendMessage(instance, messageData, attempt = 1) {
    try {
        const typingDelay = simulateTypingTime(messageData.mensaje);
        logger.info(`⌨️ Simulando escritura por ${(typingDelay / 1000).toFixed(2)}s...`);
        await new Promise(res => setTimeout(res, typingDelay));

        logger.info(`📤 Enviando mensaje desde ${instance.name} a ${messageData.tenvio}`);
        const response = await axios.post(`${CONFIG.SEND_MESSAGE_API_BASE_URL}${instance.name}`, {
            number: messageData.tenvio,
            text: messageData.mensaje
        }, {
            headers: { 'Apikey': instance.token },
            timeout: 30000
        });

        if (response.status === 201) {
            logger.info(`✅ Mensaje ${messageData.idSendmessage} enviado correctamente desde ${instance.name}`);
            sentMessages.add(messageData.idSendmessage);
            await saveSentMessages();
        } else {
            logger.warn(`⚠️ Mensaje ${messageData.idSendmessage} enviado con advertencia, status: ${response.status}`);
        }

        await confirmMessageSend(response.status, messageData.idSendmessage, instance.name);

    } catch (error) {
        logger.error(`❌ Error al enviar mensaje ${messageData.idSendmessage} desde ${instance.name}: ${error.message}`);

        if (error.response) {
            logger.error(`⚠️ Detalle del error: Status=${error.response.status}, Data=${JSON.stringify(error.response.data)}`);
        }

        if (error.response && error.response.status === 400) {
            // Fallo permanente, no reintentar
            await confirmMessageSend(400, messageData.idSendmessage, instance.name);
            logger.warn(`⚠️ Mensaje ${messageData.idSendmessage} falló con status 400. No se reintentará.`);
            return;
        }

        // Reintentar si no es 400
        if (attempt < CONFIG.MAX_RETRIES) {
            const retryDelay = getRandomTime(CONFIG.RETRY_DELAY_MIN, CONFIG.RETRY_DELAY_MAX);
            logger.warn(`🔄 Reintentando mensaje ${messageData.idSendmessage} en ${(retryDelay / 1000).toFixed(2)}s (Intento ${attempt+1}/${CONFIG.MAX_RETRIES})`);
            await new Promise(res => setTimeout(res, retryDelay));
            return sendMessage(instance, messageData, attempt + 1);
        } else {
            logger.error(`❌ Falló al enviar mensaje ${messageData.idSendmessage} después de ${CONFIG.MAX_RETRIES} intentos.`);
        }

    } finally {
        inProgressMessages.delete(messageData.idSendmessage);
    }
}

// Confirmar envío
async function confirmMessageSend(statusCode, idSendmessage, instanceName) {
    const cenvio = statusCode === 201 ? 1 : 2;
    try {
        const response = await axios.post(CONFIG.CONFIRMATION_API_URL, {
            Idenvio: idSendmessage,
            Ninstancia: instanceName,
            Cenvio: cenvio
        });
        logger.info(`✅ Confirmación de envío para ID ${idSendmessage}: Respuesta ${response.status}`);
    } catch (error) {
        logger.error(`⚠️ Error al confirmar envío de ${idSendmessage}: ${error.message}`);
    }
}

// Gestión de envío por instancia
async function manageInstanceSending(instance, flag) {
    while (flag.active) {
        const messageData = await getNextQueueMessage();

        if (!messageData) {
            logger.info(`📭 ${instance.name} no tiene mensajes. Esperando 30s...`);
            await new Promise(res => setTimeout(res, CONFIG.POLLING_MESSAGE_INTERVAL));
            continue;
        }

        if (inProgressMessages.has(messageData.idSendmessage)) {
            logger.warn(`⚠️ Mensaje ${messageData.idSendmessage} duplicado detectado, saltando...`);
            continue;
        }

        if (sentMessages.has(messageData.idSendmessage)) {
            logger.warn(`⚠️ Mensaje ${messageData.idSendmessage} ya enviado anteriormente, saltando...`);
            continue;
        }

        // Revisar si la instancia llegó al máximo
        if (instance.messagesSentCount >= CONFIG.MAX_MESSAGES_PER_INSTANCE) {
            const longBreak = simulateOccasionalBreak();
            if (longBreak > 0) {
                logger.info(`🛑 ${instance.name} descansa ${(longBreak/60000).toFixed(2)} min.`);
                instance.messagesSentCount = 0;
                await new Promise(res => setTimeout(res, longBreak));
            } else {
                const pauseTime = getExtendedRandomTime();
                logger.info(`⏳ Pausa en ${instance.name} por ${(pauseTime/1000).toFixed(2)}s.`);
                instance.messagesSentCount = 0;
                await new Promise(res => setTimeout(res, pauseTime));
            }
        }

        inProgressMessages.add(messageData.idSendmessage);
        await sendMessage(instance, messageData);
        instance.messagesSentCount++;

        const waitTime = getExtendedRandomTime();
        logger.info(`⏳ ${instance.name} espera ${(waitTime/1000).toFixed(2)}s antes del siguiente mensaje.`);
        await new Promise(res => setTimeout(res, waitTime));
    }

    logger.info(`🛑 ${instance.name} detenido por desconexión.`);
}

// Bucle principal
async function manageMessageSending() {
    await loadSentMessages();

    while (true) {
        logger.info('🚀 Iniciando ciclo de gestión de envío...');
        await getActiveInstances();   
        await fetchMessageQueue();

        if (instances.length === 0) {
            logger.warn('⚠️ Sin instancias activas. Esperando 60s para reintentar.');
            await new Promise(res => setTimeout(res, CONFIG.POLLING_INTERVAL));
            continue;
        }

        // Esperar 1 min antes de volver a actualizar cola e instancias
        await new Promise(res => setTimeout(res, CONFIG.POLLING_INTERVAL));
    }
}

// Manejo de errores globales
process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

process.on('uncaughtException', (error) => {
    logger.error(`Uncaught Exception: ${error.message}`);
    process.exit(1);
});

// Inicializar
async function initialize() {
    await loadSentMessages();
    manageMessageSending().catch(error => {
        logger.error(`🔴 Error crítico: ${error.message}`);
        process.exit(1);
    });
}

initialize();
