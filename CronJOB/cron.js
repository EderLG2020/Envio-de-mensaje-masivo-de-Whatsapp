const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const logFilePath = path.join(__dirname, 'envio.log');
const inProgressMessages = new Set();
let instances = [];

const CONFIG = {
    MAX_MESSAGES_PER_INSTANCE: 7,
    MESSAGE_INTERVAL_MIN: 20000,
    MESSAGE_INTERVAL_MAX: 60000,
    EXTENDED_PAUSE_PROBABILITY: 0.25,
    EXTENDED_PAUSE_MIN: 60000,
    EXTENDED_PAUSE_MAX: 180000,
    OCCASIONAL_BREAK_PROBABILITY: 0.10,
    OCCASIONAL_BREAK_MIN: 120000,
    OCCASIONAL_BREAK_MAX: 300000,
    RETRY_DELAY_MIN: 30000,
    RETRY_DELAY_MAX: 120000,
    QUEUE_API_URL: 'http://188.245.38.255:5000/api/sendwhatsapp/colaenvio/?empresa=yego',
    CONFIRMATION_API_URL: 'http://188.245.38.255:5000/api/sendwhatsapp/envio',
    INSTANCES_API_URL: 'http://localhost:5000/api/instances',
    SEND_MESSAGE_API_BASE_URL: 'https://apievo.3w.pe/message/sendText/',
    LOG_FILE: logFilePath,
    LOG_ENCODING: 'utf8'
};

function getCurrentTime() {
    return new Date().toLocaleTimeString();
}

async function writeToLog(status, number, messageId, instanceName) {
    const currentTime = new Date().toLocaleString();
    const logMessage = `[${currentTime}] Número: ${number} - ID Mensaje: ${messageId} - Estado: ${status} - Instancia: ${instanceName}\n`;
    try {
        await fs.appendFile(CONFIG.LOG_FILE, logMessage, CONFIG.LOG_ENCODING);
    } catch (err) {
        console.error(`[${getCurrentTime()}] Error al escribir en el archivo de log:`, err.message);
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
        console.log(`[${getCurrentTime()}] 🛑 Tomando una pausa de ${(longBreak / 1000 / 60).toFixed(2)} minutos para evitar detección.`);
        return longBreak;
    }
    return 0;
}

function simulateTypingTime(message) {
    const words = message.split(' ').length;
    const readingTime = getRandomTime(2000, 4000);
    const writingTime = getRandomTime(3000, 6000) + words * getRandomTime(80, 200);
    return readingTime + writingTime;
}

async function getActiveInstances() {
    try {
        console.log(`[${getCurrentTime()}] 🔍 Consultando instancias activas...`);
        const response = await axios.get(CONFIG.INSTANCES_API_URL);
        const activeInstances = response.data.filter(instance => instance.connectionStatus === 'open');

        if (activeInstances.length > 0) {
            console.log(`[${getCurrentTime()}] 🟢 Instancias activas encontradas: ${activeInstances.map(i => i.name).join(', ')}`);
        } else {
            console.log(`[${getCurrentTime()}] ⚪ No se encontraron instancias activas.`);
        }

        instances = activeInstances.map(instance => ({
            name: instance.name,
            ownerJid: instance.ownerJid,
            token: instance.token,
            messagesSentCount: 0,
            isPaused: false
        }));
    } catch (error) {
        console.error(`[${getCurrentTime()}] ⚠️ Error al obtener instancias: ${error.message}`);
        instances = [];
    }
}

async function getNextQueueMessage() {
    try {
        const response = await axios.get(CONFIG.QUEUE_API_URL);

        if (response.data.message === "No hay registros en la cola de envío.") {
            return null;
        }

        if (inProgressMessages.has(response.data.idSendmessage)) {
            return null;
        }

        console.log(`[${getCurrentTime()}] 📬 Nuevo mensaje en la cola de envío: ${response.data.idSendmessage}`);
        return response.data;
    } catch (error) {
        console.error(`[${getCurrentTime()}] ⚠️ Error al obtener la cola de envío: ${error.message}`);
        return null;
    }
}

async function sendMessage(instance, messageData) {
    try {
        const typingDelay = simulateTypingTime(messageData.mensaje);
        console.log(`[${getCurrentTime()}] ⌨️ Simulando tiempo de escritura por ${(typingDelay / 1000).toFixed(2)} segundos...`);
        await new Promise(resolve => setTimeout(resolve, typingDelay));

        console.log(`[${getCurrentTime()}] 📤 Enviando mensaje desde ${instance.name} a número: ${messageData.tenvio}`);

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
            console.log(`[${getCurrentTime()}] ✅ Mensaje enviado correctamente desde ${instance.name}`);
            await writeToLog('Enviado correctamente', messageData.tenvio, messageData.idSendmessage, instance.name);
        } else {
            console.log(`[${getCurrentTime()}] ⚠️ Mensaje enviado con advertencia desde ${instance.name}, status: ${response.status}`);
            await writeToLog('Enviado con advertencia', messageData.tenvio, messageData.idSendmessage, instance.name);
        }

        await confirmMessageSend(response.status, messageData.idSendmessage, instance.name);

    } catch (error) {
        console.error(`[${getCurrentTime()}] ❌ Error al enviar mensaje desde ${instance.name}: ${error.message}`);
        await writeToLog('Error en el envío', messageData.tenvio, messageData.idSendmessage, instance.name);

        if (error.response && error.response.status === 400) {
            await confirmMessageSend(400, messageData.idSendmessage, instance.name);
        }

        const errorPause = getExtendedRandomTime();
        console.log(`[${getCurrentTime()}] ⏳ Pausando después de error por ${(errorPause / 1000).toFixed(2)} segundos para evitar detección.`);
        await new Promise(resolve => setTimeout(resolve, errorPause));

    } finally {
        inProgressMessages.delete(messageData.idSendmessage);
    }
}

async function confirmMessageSend(statusCode, idSendmessage, instanceName) {
    const cenvio = statusCode === 201 ? 1 : 2;
    try {
        await axios.post(CONFIG.CONFIRMATION_API_URL, {
            Idenvio: idSendmessage,
            Ninstancia: instanceName,
            Cenvio: cenvio
        });
        console.log(`[${getCurrentTime()}] ✅ Confirmación realizada para el idSendmessage: ${idSendmessage}`);
    } catch (error) {
        console.error(`[${getCurrentTime()}] ⚠️ Error al confirmar el envío de ${instanceName}: ${error.message}`);
    }
}

async function manageInstanceSending(instance) {
    while (true) {
        if (instance.isPaused) {
            await new Promise(resolve => setTimeout(resolve, CONFIG.MESSAGE_INTERVAL_MIN));
            continue;
        }

        const message = await getNextQueueMessage();
        if (message) {
            const messageData = message;

            if (inProgressMessages.has(messageData.idSendmessage)) {
                console.log(`[${getCurrentTime()}] ⚠️ Mensaje duplicado detectado: ${messageData.idSendmessage}`);
                continue;
            }

            inProgressMessages.add(messageData.idSendmessage);

            await sendMessage(instance, messageData);
            instance.messagesSentCount++;

            if (instance.messagesSentCount >= CONFIG.MAX_MESSAGES_PER_INSTANCE) {
                const longBreak = simulateOccasionalBreak();
                if (longBreak > 0) {
                    console.log(`[${getCurrentTime()}] 🛑 La instancia ${instance.name} tomará un descanso de ${(longBreak / 1000 / 60).toFixed(2)} minutos.`);
                    instance.isPaused = true;
                    instance.messagesSentCount = 0;
                    await new Promise(resolve => setTimeout(resolve, longBreak));
                    instance.isPaused = false;
                } else {
                    const pauseTime = getExtendedRandomTime();
                    console.log(`[${getCurrentTime()}] ⏳ Pausando la instancia ${instance.name} por ${(pauseTime / 1000).toFixed(2)} segundos.`);
                    instance.messagesSentCount = 0;
                    await new Promise(resolve => setTimeout(resolve, pauseTime));
                }
            } else {
                const waitTime = getExtendedRandomTime();
                console.log(`[${getCurrentTime()}] ⏳ Esperando ${(waitTime / 1000).toFixed(2)} segundos antes de enviar el siguiente mensaje.`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        } else {
            console.log(`[${getCurrentTime()}] 📭 No hay mensajes en la cola. Esperando 30 segundos antes de reintentar.`);
            await new Promise(resolve => setTimeout(resolve, 30000));
        }
    }
}

async function manageMessageSending() {
    while (true) {
        console.log(`[${getCurrentTime()}] 🚀 Iniciando envío de mensajes en paralelo...`);
        await getActiveInstances();

        if (instances.length === 0) {
            console.log(`[${getCurrentTime()}] ⚠️ No hay instancias activas. Esperando 60 segundos antes de reintentar.`);
            await new Promise(resolve => setTimeout(resolve, 60000));
            continue;
        }

        const sendingPromises = instances.map(instance => manageInstanceSending(instance));
        await Promise.all(sendingPromises);
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

manageMessageSending().catch(error => {
    console.error(`[${getCurrentTime()}] 🔴 Error crítico en manageMessageSending: ${error.message}`);
    process.exit(1);
});
