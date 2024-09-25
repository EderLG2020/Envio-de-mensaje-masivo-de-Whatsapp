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

// Función para simular un comportamiento humano con pausas más largas y aleatorias
function getExtendedRandomTime() {
    const randomChance = Math.random();
    if (randomChance < 0.15) { // 15% de probabilidad de hacer una pausa extendida (simula actividad natural)
        return getRandomTime(60000, 300000); // Pausa de 1 a 5 minutos
    }
    return getRandomTime(5000, 60000); // Pausa normal de 5 segundos a 1 minuto
}

// Ajusta el rango de tiempo para pausas largas y cortas
// function getExtendedRandomTime() {
//     const randomChance = Math.random();
//     if (randomChance < 0.15) { // Mantén la probabilidad de pausas largas
//         return getRandomTime(30000, 120000); // Reduce la pausa larga de 30 segundos a 2 minutos
//     }
//     return getRandomTime(3000, 15000); // Pausa normal de 3 a 15 segundos (más corta para agilizar el envío)
// }

// Simular tiempo de escritura basado en la longitud del mensaje y comportamiento humano
function simulateTypingTime(message) {
    const words = message.split(' ').length;
    const readingTime = getRandomTime(2000, 3000); // Tiempo de "lectura" del mensaje antes de escribir
    const writingTime = getRandomTime(2000, 5000) + words * getRandomTime(50, 300);
    return readingTime + writingTime;
}

// Ajusta el tiempo de escritura para hacerlo más rápido pero aún realista
// function simulateTypingTime(message) {
//     const words = message.split(' ').length;
//     const readingTime = getRandomTime(1000, 2000); // Reduce el tiempo de "lectura"
//     const writingTime = getRandomTime(1500, 4000) + words * getRandomTime(30, 150); // Reduce el tiempo de escritura por palabra
//     return readingTime + writingTime;
// }

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
            token: instance.token
        }));
    } catch (error) {
        console.error(`[${getCurrentTime()}] ⚠️ Error al obtener instancias: ${error.message}`);
        return [];
    }
}

// Función para obtener los datos de la cola de mensajes
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

// Función para enviar mensajes a través de una instancia
async function sendMessage(instance, messageData) {
    try {
        const typingDelay = simulateTypingTime(messageData.mensaje);
        console.log(`[${getCurrentTime()}] ⌨️ Simulando tiempo de escritura por ${typingDelay / 1000} segundos...`);
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

        // Introducir una pausa más larga después de un error para simular la reacción de un humano al encontrar un problema
        const errorPause = getExtendedRandomTime();
        console.log(`[${getCurrentTime()}] ⏳ Pausando después de error por ${(errorPause / 1000).toFixed(2)} segundos para evitar detección.`);
        await new Promise(resolve => setTimeout(resolve, errorPause));
    }
}

// Función para confirmar el envío de mensajes
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

    const intervalId = setInterval(async () => {
        try {
            const availableInstances = instances.filter(instance => instance);

            if (availableInstances.length > 0) {
                const messageData = await getQueueMessages(lastMessageId);

                if (messageData) {
                    lastMessageId = messageData.idSendmessage;

                    // Seleccionar aleatoriamente una instancia para rotación
                    const selectedInstance = availableInstances[Math.floor(Math.random() * availableInstances.length)];
                    console.log(`[${getCurrentTime()}] 🚀 La instancia ${selectedInstance.name} está lista para enviar el mensaje`);

                    await sendMessage(selectedInstance, messageData);

                    const nextDelay = getExtendedRandomTime();
                    console.log(`[${getCurrentTime()}] ⏳ La instancia ${selectedInstance.name} esperará ${(nextDelay / 1000).toFixed(2)} segundos antes de enviar otro mensaje.`);
                    setTimeout(() => { }, nextDelay);
                }
            } else {
                console.log(`[${getCurrentTime()}] ⏸️ No hay instancias disponibles para el envío de mensajes.`);
            }
        } catch (error) {
            console.error(`[${getCurrentTime()}] ⚠️ Error durante la gestión de envío de mensajes: ${error.message}`);
        }
    }, getExtendedRandomTime());
}

// Iniciar el proceso de envío
manageMessageSending();
