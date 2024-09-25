import axios from 'axios';

// Base URL para la API
const API_URL = 'http://localhost:5000/api';

// Función para obtener las instancias
export const fetchInstances = async () => {
    try {
        const response = await axios.get(`${API_URL}/instances`);
        return response.data; // Asegúrate de devolver response.data
    } catch (error) {
        console.error('Error fetching instances:', error);
        throw error; // Opcional: propaga el error para manejarlo en el código
    }
};

// Función para crear una nueva instancia
export const createInstance = async (instanceName) => {
    try {
        const response = await axios.post(`${API_URL}/create-instance`, { instanceName });
        return response.data;
    } catch (error) {
        console.error('Error creating instance:', error);
        throw error;
    }
};

export const logoutInstance = async (instanceName) => {
    try {
        const response = await axios.delete(`${API_URL}/logout-instance/${instanceName}`);
        return response.data;
    } catch (error) {
        console.error('Error logging out instance:', error);
        throw error.response?.data || error;
    }
};

export const deleteInstance = async (instanceName) => {
    try {
        const response = await axios.delete(`${API_URL}/delete-instance/${instanceName}`);
        return response.data;
    } catch (error) {
        console.error('Error deleting instance:', error);
        throw error.response?.data || error;
    }
};

// Función para generar el QR de una instancia
export const generateQrCode = async (instanceName) => {
    try {
        const response = await axios.get(`${API_URL}/generate-qr/${instanceName}`);
        return response.data;  // Se espera que esto devuelva el base64
    } catch (error) {
        console.error('Error generating QR code:', error);
        throw error.response?.data || error;
    }
};

export const checkInstanceExists = async (name) => {
    try {
        // Llamada a la API para obtener todas las instancias
        const response = await axios.get('http://localhost:5000/api/instances');
        const instances = response.data; // Suponemos que la respuesta contiene el array de instancias

        // Verificamos si alguna instancia tiene el mismo nombre
        const instanceExists = instances.some(instance => instance.name === name);

        return instanceExists; // Devuelve true si la instancia existe
    } catch (error) {
        console.error('Error checking instance existence:', error);
        return false; // Si hay un error, asumimos que no existe
    }
};

// Función para enviar WhatsApp usando la API local
export const sendWhatsApp = async (idmensaje, Tenvio, Ninstancia, Cenvio) => {
    try {
        const response = await axios.post(`${API_URL}/send-whatsapp/envio`, {
            idmensaje,
            Tenvio,
            Ninstancia,
            Cenvio
        });
        return response.data;
    } catch (error) {
        console.error('Error sending WhatsApp message:', error);
        throw error.response?.data || error;
    }
};

// Función para registrar una campaña de WhatsApp usando la API local
export const registerCampaign = async (campania, titulo, mensaje, tipo, cantidad, telefonosNombres) => {
    try {
        const response = await axios.post(`${API_URL}/send-whatsapp/registro`, {
            Campania: campania,
            Titulo: titulo,
            Mensaje: mensaje,
            Tipo: tipo,
            Cantidad: cantidad,
            TelefonosNombres: telefonosNombres  // Se envía el array de objetos con Tenvio y Nevio
        });
        return response.data;
    } catch (error) {
        console.error('Error registering campaign:', error);
        throw error.response?.data || error;
    }
};


// Función para obtener el resumen de WhatsApp usando la API local
export const getWhatsAppSummary = async () => {
    try {
        const response = await axios.get(`${API_URL}/send-whatsapp/resumen`);
        return response.data;
    } catch (error) {
        console.error('Error fetching WhatsApp summary:', error);
        throw error.response?.data || error;
    }
};