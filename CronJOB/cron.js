const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const Joi = require('joi');

// Configuración de Winston para logs con rotación diaria
const logger = winston.createLogger({
    level: 'info', // Nivel mínimo de logeo
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(info => `[${info.timestamp}] ${info.level.toUpperCase()}: ${info.message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'envio.log' }) // Puedes cambiar esto a un archivo con rotación si lo deseas
    ],
    exitOnError: false, // No cerrar el proceso en caso de error
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
    QUEUE_API_URL: 'http://188.245.38.255:5000/api/sendwhatsapp/colaenvio/?empresa=yego', // Actualizar si es necesario
    CONFIRMATION_API_URL: 'http://188.245.38.255:5000/api/sendwhatsapp/envio',
    INSTANCES_API_URL: 'http://localhost:5000/api/instances',
    SEND_MESSAGE_API_BASE_URL: 'https://apievo.3w.pe/message/sendText/',
    LOG_ENCODING: 'utf8',
    MAX_RETRIES: 3, // Número máximo de reintentos
    POLLING_INTERVAL: 60000, // Intervalo para polling de instancias en ms
    POLLING_MESSAGE_INTERVAL: 30000, // Intervalo para polling de mensajes en ms
    SENT_MESSAGES_FILE: path.join(__dirname, 'sentMessages.json')
};

// Esquema de validación para la respuesta de la cola de envío
const messageSchema = Joi.object({
    idSendmessage: Joi.number().required(),
    tenvio: Joi.string().required(),
    mensaje: Joi.string().required(),
    // Añade otras propiedades según sea necesario
}).unknown(true); // Permite propiedades adicionales

// Conjunto para rastrear mensajes en progreso
const inProgressMessages = new Set();

// Lista de instancias activas
let instances = [];

// Conjunto para rastrear mensajes ya enviados
let sentMessages = new Set();

// Flags para gestionar la ejecución de manageInstanceSending
const instanceFlags = {};

// Cola centralizada de mensajes
let messageQueue = [];

// Función para cargar mensajes enviados desde el archivo
async function loadSentMessages() {
    try {
        const data = await fs.readFile(CONFIG.SENT_MESSAGES_FILE, CONFIG.LOG_ENCODING);
        const parsed = JSON.parse(data);
        sentMessages = new Set(parsed);
        logger.info(`✅ Cargados ${sentMessages.size} mensajes previamente enviados.`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            // Archivo no existe, crear uno nuevo
            await fs.writeFile(CONFIG.SENT_MESSAGES_FILE, JSON.stringify([]), CONFIG.LOG_ENCODING);
            sentMessages = new Set();
            logger.info('✅ Archivo de mensajes enviados creado.');
        } else {
            logger.error(`⚠️ Error al cargar mensajes enviados: ${error.message}`);
            sentMessages = new Set();
        }
    }
}

// Función para guardar mensajes enviados en el archivo
async function saveSentMessages() {
    try {
        await fs.writeFile(CONFIG.SENT_MESSAGES_FILE, JSON.stringify([...sentMessages]), CONFIG.LOG_ENCODING);
        logger.info(`✅ Guardados ${sentMessages.size} mensajes enviados en el archivo.`);
    } catch (error) {
        logger.error(`⚠️ Error al guardar mensajes enviados: ${error.message}`);
    }
}

// Función para obtener el tiempo actual formateado
function getCurrentTime() {
    return new Date().toLocaleTimeString();
}

// Función para escribir en el archivo de log de mensajes
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
        logger.debug(`Consultando la cola de envío en: ${CONFIG.INSTANCES_API_URL}`);
        const response = await axios.get(CONFIG.INSTANCES_API_URL);
        const activeInstances = response.data.filter(instance => instance.connectionStatus === 'open');

        if (activeInstances.length > 0) {
            logger.info(`🟢 Instancias activas encontradas: ${activeInstances.map(i => i.name).join(', ')}`);
        } else {
            logger.warn('⚪ No se encontraron instancias activas.');
        }

        // Detectar instancias nuevas y desconectadas
        const activeInstanceNames = activeInstances.map(instance => instance.name);
        const previousInstanceNames = instances.map(instance => instance.name);

        // Identificar nuevas instancias
        const newInstances = activeInstances.filter(instance => !previousInstanceNames.includes(instance.name));
        // Identificar instancias desconectadas
        const disconnectedInstances = instances.filter(instance => !activeInstanceNames.includes(instance.name));

        // Actualizar la lista de instancias activas
        instances = activeInstances.map(instance => ({
            name: instance.name,
            ownerJid: instance.ownerJid,
            token: instance.token,
            messagesSentCount: instance.messagesSentCount || 0,
            isPaused: instance.isPaused || false
        }));

        // Iniciar manageInstanceSending para nuevas instancias
        for (const instance of newInstances) {
            if (!instanceFlags[instance.name]) {
                instanceFlags[instance.name] = { active: true };
                manageInstanceSending(instance, instanceFlags[instance.name]).catch(error => {
                    logger.error(`🔴 Error en manageInstanceSending para ${instance.name}: ${error.message}`);
                });
            }
        }

        // Detener manageInstanceSending para instancias desconectadas
        for (const instance of disconnectedInstances) {
            if (instanceFlags[instance.name]) {
                instanceFlags[instance.name].active = false;
                logger.info(`🛑 Deteniendo envío de mensajes para la instancia ${instance.name} por desconexión.`);
            }
        }

    } catch (error) {
        logger.error(`⚠️ Error al obtener instancias: ${error.message}`);
        instances = [];
    }
}

// Función para obtener la cola de mensajes
async function fetchMessageQueue() {
    try {
        logger.info('🔄 Actualizando la cola de mensajes...');
        logger.debug(`Consultando la cola de envío en: ${CONFIG.QUEUE_API_URL}`);
        const response = await axios.get(CONFIG.QUEUE_API_URL);

        // Verificar si la API indica que no hay mensajes
        if (response.data.message && response.data.message === "No hay registros en la cola de envío.") {
            logger.info('📭 No hay mensajes en la cola.');
            messageQueue = []; // Vaciar la cola local
            return;
        }

        // Verificar si la respuesta es un array o un único objeto
        if (!Array.isArray(response.data)) {
            // Asumir que la API devuelve un único mensaje como objeto
            const { error, value } = messageSchema.validate(response.data);
            if (error) {
                logger.error(`❌ Mensaje con estructura inválida detectado: ${error.message}. Datos: ${JSON.stringify(response.data)}`);
                return;
            }

            if (!inProgressMessages.has(value.idSendmessage) && !sentMessages.has(value.idSendmessage)) {
                messageQueue.push(value);
                logger.info(`📬 Se agregó un nuevo mensaje a la cola: ID ${value.idSendmessage}`);
            }
        } else {
            // La API devuelve un array de mensajes
            const apiMessageIds = new Set();
            const newMessages = [];

            response.data.forEach(message => {
                // Validar la estructura
                const { error, value } = messageSchema.validate(message);
                if (error) {
                    logger.error(`❌ Mensaje con estructura inválida detectado: ${error.message}. Datos: ${JSON.stringify(message)}`);
                    return;
                }

                apiMessageIds.add(message.idSendmessage);

                // Si el mensaje ya ha sido enviado o está en progreso, no agregarlo
                if (!inProgressMessages.has(message.idSendmessage) && !sentMessages.has(message.idSendmessage)) {
                    newMessages.push(message);
                }
            });

            if (newMessages.length > 0) {
                logger.info(`📬 Se agregaron ${newMessages.length} nuevos mensajes a la cola.`);
                messageQueue.push(...newMessages);
            } else {
                logger.info('📭 No hay nuevos mensajes para agregar a la cola.');
            }

            // Eliminar de messageQueue los mensajes que ya no están en la API
            const beforeLength = messageQueue.length;
            messageQueue = messageQueue.filter(message => apiMessageIds.has(message.idSendmessage));
            const afterLength = messageQueue.length;
            if (beforeLength !== afterLength) {
                logger.info(`🗑️ Se eliminaron ${beforeLength - afterLength} mensajes obsoletos de la cola local.`);
            }
        }

    } catch (error) {
        if (error.response && error.response.status === 404) {
            // Tratar 404 como "no hay mensajes en la cola"
            logger.info('📭 No hay mensajes en la cola (Error 404).');
            messageQueue = []; // Vaciar la cola local
        } else {
            logger.error(`⚠️ Error al obtener la cola de envío: ${error.message}`);
        }
    }
}

// Función para obtener el próximo mensaje de la cola de envío
async function getNextQueueMessage() {
    try {
        await fetchMessageQueue(); // Actualizar la cola de mensajes
        if (messageQueue.length === 0) {
            return null;
        }
        return messageQueue.shift(); // Retornar y eliminar el primer mensaje de la cola
    } catch (error) {
        logger.error(`⚠️ Error en getNextQueueMessage: ${error.message}`);
        return null;
    }
}

// Función para enviar un mensaje con reintentos
async function sendMessage(instance, messageData, attempt = 1) {
    try {
        const typingDelay = simulateTypingTime(messageData.mensaje);
        logger.info(`⌨️ Simulando tiempo de escritura por ${(typingDelay / 1000).toFixed(2)} segundos...`);
        await new Promise(resolve => setTimeout(resolve, typingDelay));

        logger.info(`📤 Enviando mensaje desde ${instance.name} a número: ${messageData.tenvio}`);
        logger.debug(`📤 Datos del mensaje a enviar: Número=${messageData.tenvio}, Texto=${messageData.mensaje}`);

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
            sentMessages.add(messageData.idSendmessage);
            await saveSentMessages();
        } else {
            logger.warn(`⚠️ Mensaje enviado con advertencia desde ${instance.name}, status: ${response.status}`);
            await writeToLog('Enviado con advertencia', messageData.tenvio, messageData.idSendmessage, instance.name);
        }

        await confirmMessageSend(response.status, messageData.idSendmessage, instance.name);
    } catch (error) {
        logger.error(`❌ Error al enviar mensaje desde ${instance.name}: ${error.message}`);

        if (error.response) {
            logger.error(`⚠️ Detalle del error: Status=${error.response.status}, Data=${JSON.stringify(error.response.data)}`);
        }

        await writeToLog('Error en el envío', messageData.tenvio, messageData.idSendmessage, instance.name);

        if (error.response && error.response.status === 400) {
            // No reintentar, confirmar como fallo permanente
            await confirmMessageSend(400, messageData.idSendmessage, instance.name);
            logger.warn(`⚠️ Mensaje ID ${messageData.idSendmessage} falló con status 400. No se reintentará.`);
            return; // Salir de la función sin reintentar
        }

        // Solo reintentar si no es un error 400
        if (attempt < CONFIG.MAX_RETRIES) {
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
        const response = await axios.post(CONFIG.CONFIRMATION_API_URL, {
            Idenvio: idSendmessage,
            Ninstancia: instanceName,
            Cenvio: cenvio
        });
        logger.info(`✅ Confirmación realizada para el idSendmessage: ${idSendmessage}. Respuesta: ${response.status}`);
    } catch (error) {
        logger.error(`⚠️ Error al confirmar el envío de ${instanceName}: ${error.message}. Datos enviados: Idenvio=${idSendmessage}, Ninstancia=${instanceName}, Cenvio=${cenvio}`);
    }
}

// Función para gestionar el envío de mensajes a través de una instancia
async function manageInstanceSending(instance, flag) {
    while (flag.active) {
        // Obtener el próximo mensaje
        const messageData = await getNextQueueMessage();

        if (!messageData) {
            logger.info('📭 No hay mensajes en la cola. Esperando 30 segundos antes de reintentar.');
            await new Promise(resolve => setTimeout(resolve, CONFIG.POLLING_MESSAGE_INTERVAL));
            continue;
        }

        // Verificar si el mensaje ya está en progreso o ya fue enviado
        if (inProgressMessages.has(messageData.idSendmessage)) {
            logger.warn(`⚠️ Mensaje duplicado detectado: ${messageData.idSendmessage}`);
            continue; // Saltar al siguiente mensaje sin procesar este
        }

        if (sentMessages.has(messageData.idSendmessage)) {
            logger.warn(`⚠️ Mensaje ya enviado previamente: ${messageData.idSendmessage}`);
            continue; // Saltar al siguiente mensaje
        }

        // Verificar si la instancia ha alcanzado el máximo de mensajes permitidos
        if (instance.messagesSentCount >= CONFIG.MAX_MESSAGES_PER_INSTANCE) {
            const longBreak = simulateOccasionalBreak();
            if (longBreak > 0) {
                logger.info(`🛑 La instancia ${instance.name} tomará un descanso de ${(longBreak / 1000 / 60).toFixed(2)} minutos.`);
                instance.messagesSentCount = 0;
                await new Promise(resolve => setTimeout(resolve, longBreak));
            } else {
                const pauseTime = getExtendedRandomTime();
                logger.info(`⏳ Pausando la instancia ${instance.name} por ${(pauseTime / 1000).toFixed(2)} segundos.`);
                instance.messagesSentCount = 0;
                await new Promise(resolve => setTimeout(resolve, pauseTime));
            }
        }

        // Marcar el mensaje como en progreso
        inProgressMessages.add(messageData.idSendmessage);

        // Enviar el mensaje
        await sendMessage(instance, messageData);

        // Incrementar el contador de mensajes enviados
        instance.messagesSentCount++;

        // Esperar antes de procesar el siguiente mensaje
        const waitTime = getExtendedRandomTime();
        logger.info(`⏳ Esperando ${(waitTime / 1000).toFixed(2)} segundos antes de procesar el siguiente mensaje.`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    logger.info(`🛑 Se detiene manageInstanceSending para la instancia ${instance.name} por desconexión.`);
}

// Función principal para gestionar todas las instancias y la cola de mensajes
async function manageMessageSending() {
    await loadSentMessages(); // Cargar mensajes enviados al iniciar

    while (true) {
        logger.info('🚀 Iniciando gestión de envío de mensajes en paralelo...');
        await getActiveInstances();
        await fetchMessageQueue();

        if (instances.length === 0) {
            logger.warn('⚠️ No hay instancias activas. Esperando 60 segundos antes de reintentar.');
            await new Promise(resolve => setTimeout(resolve, CONFIG.POLLING_INTERVAL));
            continue;
        }

        // Esperar antes de volver a consultar las instancias y la cola
        await new Promise(resolve => setTimeout(resolve, CONFIG.POLLING_INTERVAL));
    }
}

// Manejo de excepciones globales
process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

process.on('uncaughtException', (error) => {
    logger.error(`Uncaught Exception: ${error.message}`);
    process.exit(1);
});

// Inicializar el sistema
async function initialize() {
    await loadSentMessages();
    manageMessageSending().catch(error => {
        logger.error(`🔴 Error crítico en manageMessageSending: ${error.message}`);
        process.exit(1);
    });
}

initialize();
