const axios = require('axios');
const fs = require('fs');
const logFilePath = './envio.log'; // Archivo para registrar mensajes
let inProgressMessages = new Set(); // Almacenar mensajes en proceso
let instances = []; // Lista de instancias activas

// Función para obtener el tiempo actual formateado
function getCurrentTime() {
    return new Date().toLocaleTimeString();
}

// Función para escribir en el archivo de log, incluyendo la instancia
function writeToLog(status, number, messageId, instanceName) {
    const currentTime = new Date().toLocaleString();
    const logMessage = `[${currentTime}] Número: ${number} - ID Mensaje: ${messageId} - Estado: ${status} - Instancia: ${instanceName}\n`;
    fs.appendFileSync(logFilePath, logMessage, (err) => {
        if (err) console.error('Error al escribir en el archivo de log:', err.message);
    });
}
// Función para obtener las instancias activas
async function getActiveInstances() {
    try {
        console.log(`[${getCurrentTime()}] 🔍 Consultando instancias activas...`);
        const response = await axios.get('http://localhost:5000/api/instances');
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
            messagesSentCount: 0,// Añadimos el contador de mensajes por instancia
            Active: false
        }));
    } catch (error) {
        console.error(`[${getCurrentTime()}] ⚠️ Error al obtener instancias: ${error.message}`);
        instances = []; // En caso de error, vaciar la lista de instancias
    }
}

// Obtener el próximo mensaje de la cola de envío
async function getNextQueueMessage() {
    try {
        const response = await axios.get('http://188.245.38.255:5000/api/sendwhatsapp/colaenvio/?empresa=yego');

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
            writeToLog('Enviado correctamente', messageData.tenvio, messageData.idSendmessage, instance.name);
        } else {
            console.log(`[${getCurrentTime()}] ⚠️ Mensaje enviado con advertencia desde ${instance.name}, status: ${response.status}`);
            writeToLog('Enviado con advertencia', messageData.tenvio, messageData.idSendmessage, instance.name);
        }

        await confirmMessageSend(response.status, messageData.idSendmessage, instance.name);
    } catch (error) {
        console.error(`[${getCurrentTime()}] ❌ Error al enviar mensaje desde ${instance.name}: ${error.message}`);
        writeToLog('Error en el envío', messageData.tenvio, messageData.idSendmessage, instance.name);

        if (error.response && error.response.status === 400) {
            await confirmMessageSend(400, messageData.idSendmessage, instance.name);
        }

    } finally {
        inProgressMessages.delete(messageData.idSendmessage); // Eliminar el mensaje de la lista de "en proceso"
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

function getCurrentTime() {
    return new Date().toLocaleTimeString();
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Devuelve un valor aleatorio entre min y max.
function getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min) + min);
}

// Demora con variación aleatoria
function getExponentialDelay(baseTime, variance) {
    return baseTime + Math.floor(Math.random() * variance);
}

// Conjunto para almacenar identificadores de mensajes enviados
const sentMessages = new Set();

async function simulateInstance(instance) {
    while (true) {
        const messageData = await getNextQueueMessage();

        if (messageData) {
            if (!sentMessages.has(messageData.idSendmessage)) {
                if (!instance.Active) {
                    instance.Active = true;
                    instance.messagesSentCount++;
                    sentMessages.add(messageData.idSendmessage); // Almacena el identificador

                    await sendMessage(instance, messageData);

                    let valorDemora;

                    if (instance.messagesSentCount < 3) {
                        valorDemora = getExponentialDelay(getRandomDelay(4000, 12000), 4000);
                    } else if (instance.messagesSentCount >= 3 && instance.messagesSentCount < 10) {
                        valorDemora = getExponentialDelay(getRandomDelay(10000, 20000), 7000);
                    } else if (instance.messagesSentCount >= 10 && instance.messagesSentCount < 20) {
                        valorDemora = getExponentialDelay(getRandomDelay(30000, 60000), 5000);
                    } else {
                        let baseDelay = getExponentialDelay(getRandomDelay(120000, 300000), 180000);

                        const rand = Math.random();

                        if (rand < 0.1) {
                            const extra2Min = getRandomDelay(120000, 240000);
                            valorDemora = baseDelay + extra2Min;
                            console.log(`[${getCurrentTime()}] 📅 Retraso extra de entre 2 y 4 minutos aplicado`);
                        } else if (rand < 0.3) {
                            const extra1Min = getRandomDelay(60000, 120000);
                            valorDemora = baseDelay + extra1Min;
                            console.log(`[${getCurrentTime()}] 📅 Retraso extra de entre 1 y 2 minutos aplicado`);
                        } else if (rand < 0.7) {
                            const extra30Seg = getRandomDelay(30000, 60000);
                            valorDemora = baseDelay + extra30Seg;
                            console.log(`[${getCurrentTime()}] 📅 Retraso extra de entre 30 y 60 segundos aplicado`);
                        } else {
                            const extra15Seg = getRandomDelay(15000, 30000);
                            valorDemora = baseDelay + extra15Seg;
                            console.log(`[${getCurrentTime()}] 📅 Retraso extra de entre 15 y 30 segundos aplicado`);
                        }
                    }

                    await delay(valorDemora);

                    instance.Active = false;
                }
            } else {
                console.log(`[${getCurrentTime()}] Mensaje duplicado descartado: ${messageData.idSendmessage}`);
            }
        } else {
            await delay(3000); // Espera 3 segundos antes de volver a consultar
            break;
        }
    }
}


async function manageMessageSending() {
    await getActiveInstances(); // Consultar las instancias activas inicialmente
    instances.forEach(instance => {
        simulateInstance(instance);
    });
}
// Iniciar el proceso de envío
manageMessageSending();
