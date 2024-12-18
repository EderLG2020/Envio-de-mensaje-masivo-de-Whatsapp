const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// Biblioteca para manejo avanzado de logs
const winston = require('winston');

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
    ]
});

// Configuración centralizada
const CONFIG = {
    MAX_MESSAGES_PER_INSTANCE: 7,
    MESSAGE_INTERVAL_MIN: 20000, // 20 segundos
    MESSAGE_INTERVAL_MAX: 60000, // 1 minuto
    EXTENDED_PAUSE_PROBABILITY: 0.25,
    EXTENDED_PAUSE_MIN: 60000, // 1 minuto
    EXTENDED_PAUSE_MAX: 180000, // 3 minutos
    OCCASIONAL_BREAK_PROBABILITY: 0.10,
    OCCASIONAL_BREAK_MIN: 120000, // 2 minutos
    OCCASIONAL_BREAK_MAX: 300000, // 5 minutos
    RETRY_DELAY_MIN: 30000, // 30 segundos
    RETRY_DELAY_MAX: 120000, // 2 minutos
    QUEUE_API_URL: 'http://188.245.38.255:5000/api/sendwhatsapp/colaenvio/?empresa=yego',
    CONFIRMATION_API_URL: 'http://188.245.38.255:5000/api/sendwhatsapp/envio',
    INSTANCES_API_URL: 'http://localhost:5000/api/instances',
    SEND_MESSAGE_API_BASE_URL: 'https://apievo.3w.pe/message/sendText/',
    LOG_ENCODING: 'utf8',
    MAX_RETRIES: 3 // Número máximo de reintentos
};

// Conjunto para rastrear mensajes en progreso
const inProgressMessages = new Set();

// Lista de instancias activas
let instances = [];

// Cola centralizada de mensajes
let messageQueue = [];

// Función para obtener el tiempo actual formateado
function getCurrentTime() {
    return new Date().toLocaleTimeString();
}

// Función para generar un tiempo aleatorio
function getRandomTime(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Función para generar un tiempo aleatorio extendido
function getExtendedRandomTime() {
    const randomChance = Math.random();
    if (randomChance < CONFIG.EXTENDED_PAUSE_PROBABILITY) {
        return getRandomTime(CONFIG.EXTENDED_PAUSE_MIN, CONFIG.EXTENDED_PAUSE_MAX);
    }
    return getRandomTime(CONFIG.MESSAGE_INTERVAL_MIN, CONFIG.MESSAGE_INTERVAL_MAX);
}

// Función para simular pausas ocasionales prolongadas
function simulateOccasionalBreak() {
    const chance = Math.random();
    if (chance < CONFIG.OCCASIONAL_BREAK_PROBABILITY) {
        const longBreak = getRandomTime(CONFIG.OCCASIONAL_BREAK_MIN, CONFIG.OCCASIONAL_BREAK_MAX);
        logger.info(`🛑 Tomando una pausa de ${(longBreak / 1000 / 60).toFixed(2)} minutos para evitar detección.`);
        return longBreak;
    }
    return 0;
}

// Función para simular tiempo de escritura basado en la longitud del mensaje y comportamiento humano
function simulateTypingTime(message) {
    if (!message) return 0;
    const words = message.split(' ').length;
    const readingTime = getRandomTime(2000, 4000);
    const writingTime = getRandomTime(3000, 6000) + words * getRandomTime(80, 200);
    return readingTime + writingTime;
}

// Función para obtener las instancias activas
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

        instances = activeInstances.map(instance => ({
            name: instance.name,
            ownerJid: instance.ownerJid,
            token: instance.token,
            messagesSentCount: 0,
            isPaused: false
        }));
    } catch (error) {
        logger.error(`⚠️ Error al obtener instancias: ${error.message}`);
        instances = [];
    }
}

// Función para obtener la cola de mensajes
async function fetchMessageQueue() {
    try {
        const response = await axios.get(CONFIG.QUEUE_API_URL);
        if (!Array.isArray(response.data) || response.data.length === 0) {
            logger.info('📭 No hay mensajes en la cola.');
            return;
        }

        // Filtrar mensajes que no están en progreso y tienen los campos necesarios
        const newMessages = response.data.filter(message =>
            message.idSendmessage && message.mensaje && message.tenvio && !inProgressMessages.has(message.idSendmessage)
        );

        if (newMessages.length > 0) {
            logger.info(`📬 Se agregaron ${newMessages.length} nuevos mensajes a la cola.`);
            messageQueue.push(...newMessages);
        } else {
            logger.info('📭 No hay nuevos mensajes para agregar a la cola.');
        }
    } catch (error) {
        logger.error(`⚠️ Error al obtener la cola de envío: ${error.message}`);
    }
}

// Función para enviar un mensaje con reintentos
async function sendMessage(instance, messageData, attempt = 1) {
    try {
        const typingDelay = simulateTypingTime(messageData.mensaje);
        logger.info(`⌨️ Simulando tiempo de escritura por ${(typingDelay / 1000).toFixed(2)} segundos...`);
        await new Promise(resolve => setTimeout(resolve, typingDelay));

        logger.info(`📤 Enviando mensaje desde ${instance.name} a número: ${messageData.tenvio}`);

        const response = await axios.post(`${CONFIG.SEND_MESSAGE_API_BASE_URL}${instance.name}`, {
            number: messageData.tenvio,
            text: messageData.mensaje
        }, {
            headers: {
                'Apikey': instance.token
            },
            timeout: 30000
        });

        if (response.status === 201) {
            logger.info(`✅ Mensaje enviado correctamente desde ${instance.name}`);
            await writeToLog('Enviado correctamente', messageData.tenvio, messageData.idSendmessage, instance.name);
        } else {
            logger.warn(`⚠️ Mensaje enviado con advertencia desde ${instance.name}, status: ${response.status}`);
            await writeToLog('Enviado con advertencia', messageData.tenvio, messageData.idSendmessage, instance.name);
        }

        await confirmMessageSend(response.status, messageData.idSendmessage, instance.name);
    } catch (error) {
        logger.error(`❌ Error al enviar mensaje desde ${instance.name}: ${error.message}`);
        await writeToLog('Error en el envío', messageData.tenvio, messageData.idSendmessage, instance.name);

        if (error.response && error.response.status === 400) {
            await confirmMessageSend(400, messageData.idSendmessage, instance.name);
        }

        if (attempt <= CONFIG.MAX_RETRIES) {
            const retryDelay = getRandomTime(CONFIG.RETRY_DELAY_MIN, CONFIG.RETRY_DELAY_MAX);
            logger.warn(`🔄 Reintentando enviar mensaje ID ${messageData.idSendmessage} en ${(retryDelay / 1000).toFixed(2)} segundos (Intento ${attempt}/${CONFIG.MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            return sendMessage(instance, messageData, attempt + 1);
        } else {
            logger.error(`❌ Falló al enviar mensaje ID ${messageData.idSendmessage} después de ${CONFIG.MAX_RETRIES} intentos.`);
        }
    } finally {
        inProgressMessages.delete(messageData.idSendmessage);
    }
}

// Función para confirmar el envío del mensaje
async function confirmMessageSend(statusCode, idSendmessage, instanceName) {
    const cenvio = statusCode === 201 ? 1 : 2;
    try {
        await axios.post(CONFIG.CONFIRMATION_API_URL, {
            Idenvio: idSendmessage,
            Ninstancia: instanceName,
            Cenvio: cenvio
        });
        logger.info(`✅ Confirmación realizada para el idSendmessage: ${idSendmessage}`);
    } catch (error) {
        logger.error(`⚠️ Error al confirmar el envío de ${instanceName}: ${error.message}`);
    }
}

// Función para escribir en el archivo de log utilizando Winston
async function writeToLog(status, number, messageId, instanceName) {
    const logMessage = `Número: ${number} - ID Mensaje: ${messageId} - Estado: ${status} - Instancia: ${instanceName}`;
    if (status === 'Enviado correctamente') {
        logger.info(logMessage);
    } else if (status === 'Enviado con advertencia') {
        logger.warn(logMessage);
    } else if (status === 'Error en el envío') {
        logger.error(logMessage);
    }
}

// Función para gestionar el envío de mensajes a través de una instancia
async function manageInstanceSending(instance) {
    while (true) {
        if (instance.isPaused) {
            await new Promise(resolve => setTimeout(resolve, CONFIG.MESSAGE_INTERVAL_MIN));
            continue;
        }

        if (messageQueue.length === 0) {
            logger.info('📭 No hay mensajes en la cola. Esperando 30 segundos antes de reintentar.');
            await new Promise(resolve => setTimeout(resolve, 30000));
            continue;
        }

        const messageData = messageQueue.shift();

        if (!messageData) {
            logger.info('📭 No hay mensajes disponibles en la cola.');
            await new Promise(resolve => setTimeout(resolve, 30000));
            continue;
        }

        if (inProgressMessages.has(messageData.idSendmessage)) {
            logger.warn(`⚠️ Mensaje duplicado detectado: ${messageData.idSendmessage}`);
            continue;
        }

        inProgressMessages.add(messageData.idSendmessage);

        await sendMessage(instance, messageData);
        instance.messagesSentCount++;

        if (instance.messagesSentCount >= CONFIG.MAX_MESSAGES_PER_INSTANCE) {
            const longBreak = simulateOccasionalBreak();
            if (longBreak > 0) {
                instance.isPaused = true;
                instance.messagesSentCount = 0;
                await new Promise(resolve => setTimeout(resolve, longBreak));
                instance.isPaused = false;
            } else {
                const pauseTime = getExtendedRandomTime();
                logger.info(`⏳ Pausando la instancia ${instance.name} por ${(pauseTime / 1000).toFixed(2)} segundos.`);
                instance.messagesSentCount = 0;
                await new Promise(resolve => setTimeout(resolve, pauseTime));
            }
        } else {
            const waitTime = getExtendedRandomTime();
            logger.info(`⏳ Esperando ${(waitTime / 1000).toFixed(2)} segundos antes de enviar el siguiente mensaje.`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

// Función principal para gestionar todas las instancias y la cola de mensajes
async function manageMessageSending() {
    while (true) {
        logger.info('🚀 Iniciando gestión de envío de mensajes en paralelo...');
        await getActiveInstances();
        await fetchMessageQueue();

        if (instances.length === 0) {
            logger.warn('⚠️ No hay instancias activas. Esperando 60 segundos antes de reintentar.');
            await new Promise(resolve => setTimeout(resolve, 60000));
            continue;
        }

        // Iniciar el envío de mensajes para cada instancia activa
        const sendingPromises = instances.map(instance => manageInstanceSending(instance));
        await Promise.all(sendingPromises);

        // Esperar antes de volver a consultar las instancias y la cola
        await new Promise(resolve => setTimeout(resolve, 3000));
        await fetchMessageQueue();
    }
}

// Iniciar el envío de mensajes
manageMessageSending().catch(error => {
    logger.error(`🔴 Error crítico en manageMessageSending: ${error.message}`);
    process.exit(1);
});
