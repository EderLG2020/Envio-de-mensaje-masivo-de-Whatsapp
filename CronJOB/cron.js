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
let isRunning = true;

async function calculateDelay(instance) {
    let valorDemora;
  
    // Generar un valor aleatorio para determinar si reiniciar todo (5% de probabilidad)
    const randReinicio = Math.random();
    if (randReinicio < 0.03) {
      console.log(
        `[${getCurrentTime()}] 🚨 Reiniciando todo el sistema por probabilidad del 3%.`
      );
      isRunning = false; // Detenemos el sistema global
      return null; // Indicamos al proceso principal que debe reiniciarse
    }
  
    // Retraso básico según la cantidad de mensajes enviados
    if (instance.messagesSentCount < 2) {
      valorDemora = getExponentialDelay(getRandomDelay(8000, 15000), 4000);
    } else if (
      instance.messagesSentCount >= 2 &&
      instance.messagesSentCount < 10
    ) {
      valorDemora = getExponentialDelay(getRandomDelay(15000, 120000), 15000);
    } else if (
      instance.messagesSentCount >= 10 &&
      instance.messagesSentCount < 20
    ) {
      valorDemora = getExponentialDelay(getRandomDelay(60000, 180000), 30000);
    } else {
      let baseDelay = getExponentialDelay(getRandomDelay(180000, 300000), 180000);
  
      const rand = Math.random();
  
      if (rand < 0.05) {
        const extra2Min = getRandomDelay(120000, 240000);
        valorDemora = baseDelay + extra2Min;
        console.log(
          `[${getCurrentTime()}] 📅 Retraso extra de entre 2 y 4 minutos aplicado`
        );
      } else if (rand < 0.1) {
        const extra1Min = getRandomDelay(60000, 120000);
        valorDemora = baseDelay + extra1Min;
        console.log(
          `[${getCurrentTime()}] 📅 Retraso extra de entre 1 y 2 minutos aplicado`
        );
      } else if (rand < 0.4) {
        const extra30Seg = getRandomDelay(30000, 60000);
        valorDemora = baseDelay + extra30Seg;
        console.log(
          `[${getCurrentTime()}] 📅 Retraso extra de entre 30 y 60 segundos aplicado`
        );
      } else if (rand < 0.5) {
        console.log(
          `[${getCurrentTime()}] 🚨 Reiniciando todo el sistema por probabilidad del 10%.`
        );
        isRunning = false; // Detenemos el sistema global
        return null; // Indicamos al proceso principal que debe reiniciarse
      } else {
        const extra15Seg = getRandomDelay(15000, 30000);
        valorDemora = baseDelay + extra15Seg;
        console.log(
          `[${getCurrentTime()}] 📅 Retraso extra de entre 15 y 30 segundos aplicado`
        );
      }
    }
    if (Math.random() < 0.1) {
      const pausaLarga = getRandomDelay(1 * 60000, 5 * 60000);
      console.log("Aplicando pausa larga entre 2 y 4 minutos.");
      await delay(pausaLarga);
    }
  
    // Agregar un factor de aleatorización adicional
    const randomFactor = Math.random() * getRandomDelay(5000, 10000);
    valorDemora += randomFactor;
    return valorDemora;
  }

async function simulateInstance(instance,instanciasActivas) {
    while (isRunning) {
        const messageData = await getNextQueueMessage();
        await getActiveInstances();
       
        if (messageData && instance &&instances.length==instanciasActivas ) {
            if (!sentMessages.has(messageData.idSendmessage)) {
                if (!instance.Active) {
                    instance.Active = true;
                    instance.messagesSentCount++;
                    sentMessages.add(messageData.idSendmessage);

                    await sendMessage(instance, messageData);

                    let valorDemora = await calculateDelay(instance);

                    await delay(valorDemora);

                    instance.Active = false;
                }
            }
        } else {
            console.log(`[${getCurrentTime()}] No hay más mensajes para la instancia ${instance.id}. Deteniendo todo.`);
            instance.messagesSentCount = 0;
            isRunning = false;
            return;
        }
    }
}
let instanciasActivas=0
async function manageMessageSending() {
    while (true) {
        await getActiveInstances();

        // Reinicia el conteo de mensajes para cada instancia
        instances.forEach(instance => {
            instance.messagesSentCount = 0;
            
        });
        instanciasActivas=instances.length
        while (isRunning) {
            console.log('Reiniciando proceso...');

            const hasMessages = await getNextQueueMessage(); // Verifica si hay mensajes disponibles

            if (hasMessages) {
                console.log('Procesando instancias...');
                const instancePromises = instances.map(instance => simulateInstance(instance,instanciasActivas));
                await Promise.all(instancePromises);

                console.log('Todas las instancias se han detenido.');
            } else {
                console.log('No hay mensajes disponibles. Esperando antes de consultar nuevamente...');
                await delay(10000); // Pausa de 3 segundos antes de verificar de nuevo
            }
        }
         isRunning=true
        await delay(10000);
        console.log('El proceso de envío de mensajes se ha detenido.');
       
    }

}


// Inicia el proceso de envío de mensajes
manageMessageSending();