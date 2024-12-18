let inProgressMessages = new Set();
let WhilemanageInstanceSending=false
// Lista de instancias activas
const instances = [
    {
        name: 'Avisos-01',
        ownerJid: '51908833822@s.whatsapp.net',
        token: '146E5081-02A3-4A75-9712-93348786C5DD',
        messagesSentCount: 0
    },
    {
        name: 'Avisos-02',
        ownerJid: '51908833822@s.whatsapp.net',
        token: '146E5081-02A3-4A75-9712-93348786C5DD',
        messagesSentCount: 0
    },
    {
        name: 'Avisos-03',
        ownerJid: '51908833822@s.whatsapp.net',
        token: '146E5081-02A3-4A75-9712-93348786C5DD',
        messagesSentCount: 0
    }
];

function getCurrentTime() {
    return new Date().toLocaleTimeString();
}

// Función para obtener tiempo aleatorio (milisegundos)
function getRandomTime(min, max) {
    return Math.floor(Math.random() * (max - min) + min);
}

// Función para simular pausas extendidas
function simulateOccasionalBreak() {
    const chance = Math.random();
    if (chance < 0.2) {
        const longBreak = getRandomTime(120000, 300000);  // Pausa entre 2 y 5 minutos
        console.log(`[${getCurrentTime()}] 🛑 Tomando una pausa de ${(longBreak / 1000 / 60).toFixed(2)} minutos para evitar detección.`);
        return longBreak;
    }
    return 0;
}

// Función para obtener el próximo mensaje de la cola
const getNextQueueMessage = async () => {
    return [{
        idSendmessage: Math.floor(Math.random() * 100000),
        tenvio: '51967371218',
        campania: "PROMO10 AUTOS",
        titulo: "PROMO10 AUTOS",
        mensaje: "🎄 ¡Este diciembre, viaja con Yango Pro! Haz tu primer viaje con el socio Yego y te regalamos 10 soles. 🎅💸",
        tipo: "imagen"
    }];
};

// Función para enviar mensajes simulando tiempo de escritura
async function sendMessage(instance, messageData) {
    const startTime = Date.now();
    try {
        const typingDelay = getRandomTime(2000, 5000);
        console.log(`[${getCurrentTime()}] ⌨️ Simulando tiempo de escritura por ${(typingDelay / 1000).toFixed(2)} segundos...`);
        await new Promise(resolve => setTimeout(resolve, typingDelay));

        if (instance.messagesSentCount >= 7) {
            const longBreak = simulateOccasionalBreak();
            if (longBreak > 0) {
                console.log(`[${getCurrentTime()}] 🛑 La instancia ${instance.name} tomará un descanso de ${(longBreak / 1000 / 60).toFixed(2)} minutos.`);
                await new Promise(resolve => setTimeout(resolve, longBreak));
                instance.messagesSentCount = 0;
            }
        }

        console.log(`[${getCurrentTime()}] Mensaje enviado desde ${instance.name}`);

        const endTime = Date.now();
        console.log(`[${getCurrentTime()}] Tiempo para enviar el mensaje: ${(endTime - startTime)} ms`);
    } catch (err) {
        console.error(`[${getCurrentTime()}] Error al enviar mensaje: ${err.message}`);
    }
}

// Función para gestionar el envío de mensajes en paralelo para cada instancia
async function manageInstanceSending(instance) {
    while (WhilemanageInstanceSending) {
        try {
            const messageData = await getNextQueueMessage();

            if (messageData>0) {
                inProgressMessages.add(messageData.idSendmessage);
                await sendMessage(instance, messageData);
                instance.messagesSentCount++;
            }else{
                console.error(`[${getCurrentTime()}] Error en la instancia ${instance.name}: ${err.message}`);
                await new Promise(resolve => setTimeout(resolve, 5000));  // Pausa extra en caso de error
                WhilemanageInstanceSending=false
            }
        } catch (err) {
            console.error(`[${getCurrentTime()}] Error en la instancia ${instance.name}: ${err.message}`);
            await new Promise(resolve => setTimeout(resolve, 5000));  // Pausa extra en caso de error
            WhilemanageInstanceSending=false
        }
    }
}

// Función principal para gestionar todas las instancias
async function manageMessageSending() {
    while(true){
            console.log(`[${getCurrentTime()}] 🚀 Iniciando envío de mensajes en paralelo...`);
            WhilemanageInstanceSending=true
    await Promise.all(instances.map(instance => manageInstanceSending(instance)));
    }

}

// Iniciar el envío de mensajes
manageMessageSending();


