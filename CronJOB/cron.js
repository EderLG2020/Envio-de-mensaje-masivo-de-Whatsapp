const axios = require('axios');
const fs = require('fs');
const logFilePath = './envio.log'; // Archivo para registrar mensajes
let inProgressMessages = new Set(); // Almacenar mensajes en proceso
let instances = []; // Lista de instancias activas
let tamañoInstances = 0
let whilemanageInstanceSending=true
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
            messagesSentCount: 0 // Añadimos el contador de mensajes por instancia
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
        return response.data;
    } catch (error) {
        console.error(`[${getCurrentTime()}] ⚠️ Error al obtener la cola de envío: ${error.message}`);
        whilemanageInstanceSending=false
        return null;
    }
}

async function sendMessage(instance, messageData) {
    try {
        const typingDelay = simulateTypingTime(messageData.mensaje);
        console.log(`[${getCurrentTime()}] ⌨️ Simulando tiempo de escritura por ${(typingDelay / 1000).toFixed(2)} segundos...`);
        await new Promise(resolve => setTimeout(resolve, typingDelay));

        console.log(`[${getCurrentTime()}] 📤 Enviando mensaje desde ${instance.name} a número: ${messageData.tenvio}`);

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
async function manageInstanceSending(instance, tamañoInstances) {
      while (whilemanageInstanceSending) {
        const  message= await getNextQueueMessage();
        if(message && instance){
            const messageData=message.shift();
          
            await getActiveInstances();
            if (messageData && inProgressMessages.has(messageData.idSendmessage)) {
                console.log(`[${getCurrentTime()}] ⚠️ Mensaje duplicado detectado: ${messageData.idSendmessage}`);
                continue; // Saltar al siguiente mensaje sin procesar este
            } 
            if (messageData && tamañoInstances == instances.length) {
                if (instance.messagesSentCount >= 7) {
                    const longBreak = simulateOccasionalBreak();
                    if (longBreak > 0) {
                        console.log(`[${getCurrentTime()}] 🛑 La instancia ${instance.name} tomará un descanso de ${(longBreak / 1000 / 60).toFixed(2)} minutos.`);
                    }
                    instance.messagesSentCount = 0;
                    await new Promise(resolve => setTimeout(resolve, longBreak));
                }
                inProgressMessages.add(messageData.idSendmessage);
    
                await sendMessage(instance, messageData);
                instance.messagesSentCount++;
            } else {
                await new Promise(resolve => setTimeout(resolve, 3000));  // Pausa por 5 segundos
                whilemanageInstanceSending=false
            }
    
            if (tamañoInstances != instances.length) {
                whilemanageInstanceSending=false
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
        }else{
            whilemanageInstanceSending=false
        } 
    }
   
}

// Función principal para gestionar todas las instancias
async function manageMessageSending() {
    while (true) {
        console.log(`[${getCurrentTime()}] 🚀 Iniciando envío de mensajes en paralelo...`);
        await getActiveInstances();
        tamañoInstances = instances.length
        await Promise.all(instances.map(instance => manageInstanceSending(instance, tamañoInstances)));
        whilemanageInstanceSending=true
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

// Iniciar el envío de mensajes
manageMessageSending();