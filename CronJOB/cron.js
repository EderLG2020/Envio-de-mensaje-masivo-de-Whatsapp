const axios = require('axios');
const fs = require('fs');
const logFilePath = './envio.log'; // Archivo para registrar mensajes

// Función para obtener el tiempo actual formateado
function getCurrentTime() {
    return new Date().toLocaleTimeString();
}

// Función para escribir en el archivo de log
function writeToLog(status, number, messageId) {
    const currentTime = new Date().toLocaleString();
    const logMessage = `[${currentTime}] Número: ${number} - ID Mensaje: ${messageId} - Estado: ${status}\n`;
    fs.appendFileSync(logFilePath, logMessage, (err) => {
        if (err) console.error('Error al escribir en el archivo de log:', err.message);
    });
}

// Función para generar un tiempo aleatorio para simular pausas humanas
function getRandomTime(min = 5000, max = 30000) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

// Función para simular pausas extendidas
function getExtendedRandomTime() {
    const randomChance = Math.random();
    if (randomChance < 0.25) { // 25% de probabilidad de una pausa extendida
        return getRandomTime(60000, 180000); // Pausa de 1 a 3 minutos
    }
    return getRandomTime(20000, 60000); // Pausa normal de 20 segundos a 1 minuto
}

// Función para simular pausas ocasionales prolongadas
function simulateOccasionalBreak() {
    const chance = Math.random();
    if (chance < 0.10) { // 10% de probabilidad de una pausa más prolongada
        const longBreak = getRandomTime(120000, 300000); // Pausa de 2 a 5 minutos
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
        const response = await axios.get('http://localhost:5000/api/instances');
        const instances = response.data.filter(instance => instance.connectionStatus === 'open');

        if (instances.length > 0) {
            console.log(`[${getCurrentTime()}] 🟢 Instancias activas encontradas: ${instances.map(i => i.name).join(', ')}`);
        } else {
            console.log(`[${getCurrentTime()}] ⚪ No se encontraron instancias activas.`);
        }

        return instances.map(instance => ({
            name: instance.name,
            ownerJid: instance.ownerJid,
            token: instance.token,
            messagesSentCount: 0 // Añadimos el contador de mensajes por instancia
        }));
    } catch (error) {
        console.error(`[${getCurrentTime()}] ⚠️ Error al obtener instancias: ${error.message}`);
        return [];
    }
}

// Obtener mensajes de la cola
async function getQueueMessages(lastMessageId) {
    try {
        const response = await axios.get('http://188.245.38.255:5000/api/sendwhatsapp/colaenvio');

        if (response.data.message === "No hay registros en la cola de envío.") {
            return null;
        }

        if (response.data.idSendmessage === lastMessageId) {
            return null;
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

        console.log(`[${getCurrentTime()}] 📤 Enviando mensaje desde la instancia: ${instance.name} a número: ${messageData.tenvio}`);
        const response = await axios.post(`https://apievo.3w.pe/message/sendText/${instance.name}`, {
            number: messageData.tenvio,
            text: messageData.mensaje
        }, {
            headers: {
                'Apikey': instance.token
            }
        });

        if (response.status === 201) {
            console.log(`[${getCurrentTime()}] ✅ Mensaje enviado correctamente desde ${instance.name}`);
            writeToLog('Enviado correctamente', messageData.tenvio, messageData.idSendmessage);
        } else {
            console.log(`[${getCurrentTime()}] ⚠️ Mensaje enviado con advertencia desde ${instance.name}, status: ${response.status}`);
            writeToLog('Enviado con advertencia', messageData.tenvio, messageData.idSendmessage);
        }

        await confirmMessageSend(response.status, messageData.idSendmessage, instance.name);

    } catch (error) {
        console.error(`[${getCurrentTime()}] ❌ Error al enviar mensaje desde ${instance.name}: ${error.message}`);
        writeToLog('Error en el envío', messageData.tenvio, messageData.idSendmessage);

        if (error.response && error.response.status === 400) {
            await confirmMessageSend(400, messageData.idSendmessage, instance.name);
        }

        const errorPause = getExtendedRandomTime();
        console.log(`[${getCurrentTime()}] ⏳ Pausando después de error por ${(errorPause / 1000).toFixed(2)} segundos para evitar detección.`);
        await new Promise(resolve => setTimeout(resolve, errorPause));
    }
}

// Confirmar envío de mensajes
async function confirmMessageSend(statusCode, idSendmessage, instanceName) {
    const cenvio = statusCode === 201 ? 1 : 2;
    try {
        await axios.post('http://188.245.38.255:5000/api/sendwhatsapp/envio', {
            Idenvio: idSendmessage,
            Ninstancia: instanceName,
            Cenvio: cenvio
        });
        console.log(`[${getCurrentTime()}] ✅ Confirmación realizada para el idSendmessage: ${idSendmessage}`);
    } catch (error) {
        console.error(`[${getCurrentTime()}] ⚠️ Error al confirmar el envío de ${instanceName}: ${error.message}`);
    }
}

// Función principal para gestionar el envío de mensajes
async function manageMessageSending() {
    let instances = await getActiveInstances();
    if (instances.length === 0) return;

    let lastMessageId = null;
    console.log(`[${getCurrentTime()}] 🟢 Iniciando la gestión de envío de mensajes...`);

    setInterval(async () => {
        try {
            for (const instance of instances) {
                if (instance.messagesSentCount >= 7) {
                    const longBreak = simulateOccasionalBreak();
                    if (longBreak > 0) {
                        console.log(`[${getCurrentTime()}] 🛑 La instancia ${instance.name} tomará un descanso de ${(longBreak / 1000 / 60).toFixed(2)} minutos.`);
                    } else {
                        console.log(`[${getCurrentTime()}] 🛑 La instancia ${instance.name} tomará un descanso breve.`);
                    }
                    instance.messagesSentCount = 0;
                    await new Promise(resolve => setTimeout(resolve, longBreak));
                    continue;
                }

                const messageData = await getQueueMessages(lastMessageId);

                if (messageData) {
                    lastMessageId = messageData.idSendmessage;
                    await sendMessage(instance, messageData);
                    instance.messagesSentCount++;
                    const nextDelay = getExtendedRandomTime();
                    console.log(`[${getCurrentTime()}] ⏳ La instancia ${instance.name} esperará ${(nextDelay / 1000).toFixed(2)} segundos antes de enviar otro mensaje.`);
                    await new Promise(resolve => setTimeout(resolve, nextDelay));
                }
            }
        } catch (error) {
            console.error(`[${getCurrentTime()}] ⚠️ Error durante la gestión de envío de mensajes: ${error.message}`);
        }
    }, getExtendedRandomTime());
}

// Iniciar el proceso de envío
manageMessageSending();
