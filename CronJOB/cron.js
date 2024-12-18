const axios = require('axios');
const fs = require('fs').promises; // Uso de fs.promises para operaciones asíncronas
const path = require('path');
const logFilePath = path.join(__dirname, 'envio.log'); // Ruta absoluta para evitar problemas de path
const inProgressMessages = new Set(); // Almacenar mensajes en proceso
let instances = []; // Lista de instancias activas

// Configuración centralizada
const CONFIG = {
    MAX_MESSAGES_PER_INSTANCE: 5, // Número máximo de mensajes por instancia antes de tomar un descanso
    MESSAGE_INTERVAL_MIN: 10000, // 10 segundos
    MESSAGE_INTERVAL_MAX: 60000, // 60 segundos
    EXTENDED_PAUSE_PROBABILITY: 0.25, // 25% de probabilidad de pausa extendida
    EXTENDED_PAUSE_MIN: 60000, // 1 minuto
    EXTENDED_PAUSE_MAX: 180000, // 3 minutos
    OCCASIONAL_BREAK_PROBABILITY: 0.10, // 10% de probabilidad de pausa prolongada
    OCCASIONAL_BREAK_MIN: 120000, // 2 minutos
    OCCASIONAL_BREAK_MAX: 300000, // 5 minutos
    RETRY_DELAY_MIN: 30000, // 30 segundos
    RETRY_DELAY_MAX: 120000, // 2 minutos
    QUEUE_API_URL: 'http://188.245.38.255:5000/api/sendwhatsapp/colaenvio/?empresa=yego', // URL de la cola de envío
    CONFIRMATION_API_URL: 'http://188.245.38.255:5000/api/sendwhatsapp/envio', // URL de confirmación de envío
    INSTANCES_API_URL: 'http://localhost:5000/api/instances', // URL para obtener instancias
    SEND_MESSAGE_API_BASE_URL: 'https://apievo.3w.pe/message/sendText/', // Base URL para enviar mensajes
    LOG_FILE: logFilePath,
    LOG_ENCODING: 'utf8',
    LOG_APPEND_MODE: 'a' // Modo de apertura para el archivo de log
};

// Función para obtener el tiempo actual formateado
function getCurrentTime() {
    return new Date().toLocaleString();
}

// Función para escribir en el archivo de log de manera asíncrona
async function writeToLog(status, number, messageId, instanceName) {
    const currentTime = getCurrentTime();
    const logMessage = `[${currentTime}] Número: ${number} - ID Mensaje: ${messageId} - Estado: ${status} - Instancia: ${instanceName}\n`;
    try {
        await fs.appendFile(CONFIG.LOG_FILE, logMessage, CONFIG.LOG_ENCODING);
    } catch (err) {
        console.error(`[${getCurrentTime()}] Error al escribir en el archivo de log:`, err.message);
    }
}

// Función para generar un tiempo aleatorio dentro de un rango
function getRandomTime(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Función para simular pausas extendidas
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
        console.log(`[${getCurrentTime()}] 🛑 Tomando una pausa de ${(longBreak / 1000 / 60).toFixed(2)} minutos para evitar detección.`);
        return longBreak;
    }
    return 0;
}

// Simular tiempo de escritura basado en la longitud del mensaje y comportamiento humano
function simulateTypingTime(message) {
    const words = message.split(' ').length;
    const readingTime = getRandomTime(2000, 4000); // Tiempo de "lectura"
    const writingTime = getRandomTime(3000, 6000) + words * getRandomTime(80, 200); // Tiempo de escritura
    return readingTime + writingTime;
}

// Función para obtener las instancias activas
async function getActiveInstances() {
    try {
        console.log(`[${getCurrentTime()}] 🔍 Consultando instancias activas...`);
        const response = await axios.get(CONFIG.INSTANCES_API_URL);
        const activeInstances = response.data.filter(instance => 
            instance.connectionStatus === 'open' && instance.name.startsWith('MASIVO')
        );

        if (activeInstances.length > 0) {
            console.log(`[${getCurrentTime()}] 🟢 Instancias activas encontradas: ${activeInstances.map(i => i.name).join(', ')}`);
        } else {
            console.log(`[${getCurrentTime()}] ⚪ No se encontraron instancias activas.`);
        }

        instances = activeInstances.map(instance => ({
            name: instance.name,
            ownerJid: instance.ownerJid,
            token: instance.token,
            messagesSentCount: 0, // Contador de mensajes por instancia
            isPaused: false // Indicador de si la instancia está en pausa
        }));
    } catch (error) {
        console.error(`[${getCurrentTime()}] ⚠️ Error al obtener instancias: ${error.message}`);
        instances = []; // En caso de error, vaciar la lista de instancias
    }
}

// Obtener el próximo mensaje de la cola de envío
async function getNextQueueMessage() {
    try {
        const response = await axios.get(CONFIG.QUEUE_API_URL);

        if (response.data.message === "No hay registros en la cola de envío.") {
            return null;
        }

        if (inProgressMessages.has(response.data.idSendmessage)) {
            return null; // Si ya está en progreso, ignorar
        }

        console.log(`[${getCurrentTime()}] 📬 Nuevo mensaje en la cola de envío: ${response.data.idSendmessage}`);
        return response.data;
    } catch (error) {
        console.error(`[${getCurrentTime()}] ⚠️ Error al obtener la cola de envío: ${error.message}`);
        return null;
    }
}

// Enviar mensajes
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
            timeout: 30000 // Timeout de 30 segundos para evitar esperas largas
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
        // Limpiar el mensaje del Set global para asegurar que otros intentos puedan seguir el flujo
        inProgressMessages.delete(messageData.idSendmessage);
    }
}

// Confirmar envío de mensajes
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

// Función para gestionar el envío de mensajes por instancia
async function manageInstanceSending(instance) {
    while (true) {
        // Si la instancia está en pausa, esperar
        if (instance.isPaused) {
            await new Promise(resolve => setTimeout(resolve, CONFIG.MESSAGE_INTERVAL_MIN));
            continue;
        }

        const message = await getNextQueueMessage();
        if (message) {
            const messageData = message; // Asumiendo que getNextQueueMessage devuelve un solo mensaje

            if (inProgressMessages.has(messageData.idSendmessage)) {
                console.log(`[${getCurrentTime()}] ⚠️ Mensaje duplicado detectado: ${messageData.idSendmessage}`);
                continue; // Saltar al siguiente mensaje sin procesar este
            }

            // Añadir mensaje a los mensajes en proceso
            inProgressMessages.add(messageData.idSendmessage);

            await sendMessage(instance, messageData);
            instance.messagesSentCount++;

            // Verificar si se ha alcanzado el límite de mensajes por instancia
            if (instance.messagesSentCount >= CONFIG.MAX_MESSAGES_PER_INSTANCE) {
                const longBreak = simulateOccasionalBreak();
                if (longBreak > 0) {
                    console.log(`[${getCurrentTime()}] 🛑 La instancia ${instance.name} tomará un descanso de ${(longBreak / 1000 / 60).toFixed(2)} minutos.`);
                    instance.isPaused = true;
                    instance.messagesSentCount = 0;
                    await new Promise(resolve => setTimeout(resolve, longBreak));
                    instance.isPaused = false;
                } else {
                    // Pausa normal
                    const pauseTime = getExtendedRandomTime();
                    console.log(`[${getCurrentTime()}] ⏳ Pausando la instancia ${instance.name} por ${(pauseTime / 1000).toFixed(2)} segundos.`);
                    instance.messagesSentCount = 0;
                    await new Promise(resolve => setTimeout(resolve, pauseTime));
                }
            } else {
                // Espera antes de enviar el siguiente mensaje
                const waitTime = getExtendedRandomTime();
                console.log(`[${getCurrentTime()}] ⏳ Esperando ${(waitTime / 1000).toFixed(2)} segundos antes de enviar el siguiente mensaje.`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        } else {
            // No hay mensajes disponibles, esperar antes de intentar nuevamente
            console.log(`[${getCurrentTime()}] 📭 No hay mensajes en la cola. Esperando 30 segundos antes de reintentar.`);
            await new Promise(resolve => setTimeout(resolve, 30000)); // Esperar 30 segundos
        }
    }
}

// Función principal para gestionar todas las instancias
async function manageMessageSending() {
    while (true) {
        console.log(`[${getCurrentTime()}] 🚀 Iniciando envío de mensajes en paralelo...`);
        await getActiveInstances();

        if (instances.length === 0) {
            console.log(`[${getCurrentTime()}] ⚠️ No hay instancias activas. Esperando 60 segundos antes de reintentar.`);
            await new Promise(resolve => setTimeout(resolve, 60000)); // Esperar 1 minuto
            continue;
        }

        // Iniciar el envío de mensajes para cada instancia
        const sendingPromises = instances.map(instance => manageInstanceSending(instance));

        // Esperar a que todas las instancias finalicen (lo cual nunca ocurrirá debido al bucle infinito)
        await Promise.all(sendingPromises);

        // Esperar antes de volver a consultar las instancias
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

// Iniciar el proceso de envío
manageMessageSending().catch(error => {
    console.error(`[${getCurrentTime()}] 🔴 Error crítico en manageMessageSending: ${error.message}`);
    process.exit(1); // Salir del proceso en caso de error crítico
});
