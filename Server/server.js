const express = require("express");
const axios = require("axios");
const cors = require("cors");
const moment = require("moment-timezone");
const helmet = require("helmet");

const app = express();
const PORT = process.env.PORT || 5000;

const API_BASE_URL = "https://apievo.3w.pe";
const EXTERNAL_API_BASE_URL = "http://188.245.38.255:5000"; // URL base de la nueva API
const API_KEY = "cf41278466f109de0fc8de9d55573b35";

// Middleware
app.use(cors());
app.use(express.json());
app.use(helmet());

// Rutas para las APIs
app.post("/api/create-instance", async (req, res) => {
  const { instanceName } = req.body;

  try {
    const response = await axios.post(
      `${API_BASE_URL}/instance/create`,
      {
        instanceName,
        qrcode: false,
        integration: "WHATSAPP-BAILEYS",
        rejectCall: true,
        msgCall: "No es un canal de atención",
        alwaysOnline: true,
      },
      {
        headers: {
          apikey: API_KEY,
        },
      }
    );

    const responseData = {
      ...response.data,
      status: 200,
    };

    res.status(response.status).json(responseData);
  } catch (error) {
    console.error("Error al crear la instancia:", error);
    res.status(400).json({
      message: error.response?.data.message || "Error al crear la instancia.",
      status: 400,
    });
  }
});

app.get("/api/instances", async (req, res) => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/instance/fetchInstances`,
      {
        headers: {
          apikey: API_KEY,
        },
      }
    );

    res.status(response.status).json(response.data);
  } catch (error) {
    console.error("Error al obtener las instancias:", error);
    res.status(error.response?.status || 500).json({
      message:
        error.response?.data?.message || "Error al obtener las instancias.",
      instances: [],
    });
  }
});

// Ruta POST para enviar WhatsApp
app.post("/api/send-whatsapp/envio", async (req, res) => {
  const { idmensaje, Tenvio, Ninstancia, Cenvio } = req.body;

  try {
    const response = await axios.post(
      `${EXTERNAL_API_BASE_URL}/api/sendwhatsapp/envio`,
      {
        idmensaje,
        Tenvio,
        Ninstancia,
        Cenvio,
      }
    );

    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(
      "Error en el envío de WhatsApp:",
      error.response?.data || error.message
    );

    if (error.response) {
      // Si la API externa devuelve un error, reenviamos la respuesta original
      res.status(error.response.status).json(error.response.data);
    } else {
      // Si hay un error de conexión u otro tipo, devolvemos un error genérico
      res.status(500).json({
        message: "Error en el servidor o en la conexión a la API externa.",
      });
    }
  }
});

// Ruta POST para registrar la campaña
app.post("/api/send-whatsapp/registro", async (req, res) => {
  const {
    Campania,
    Titulo,
    Mensaje,
    Tipo,
    Cantidad,
    Empresa,
    TelefonosNombres,
  } = req.body;

  try {
    // Realizar la solicitud POST a la API externa con el nuevo formato de body
    const response = await axios.post(
      `${EXTERNAL_API_BASE_URL}/api/sendwhatsapp/Registro`,
      {
        // const response = await axios.post('http://10.10.10.10:5000/api/sendwhatsapp/Registro', {
        Campania,
        Titulo,
        Mensaje,
        Tipo,
        Cantidad,
        Empresa,
        TelefonosNombres,
      }
    );

    // Responder con el status y los datos de la API externa
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(
      "Error en el registro de la campaña:",
      error.response?.data || error.message
    );

    if (error.response) {
      // Si la API externa devuelve un error, reenviamos la respuesta original
      res.status(error.response.status).json(error.response.data);
    } else {
      // Si hay un error de conexión u otro tipo, devolvemos un error genérico
      res.status(500).json({
        message: "Error en el servidor o en la conexión a la API externa.",
      });
    }
  }
});

// Ruta GET para obtener el resumen
// app.get('/api/send-whatsapp/resumen', async (req, res) => {
//     try {
//         const response = await axios.get(`${EXTERNAL_API_BASE_URL}/api/sendwhatsapp/resumen`);

//         res.status(response.status).json(response.data);
//     } catch (error) {
//         console.error('Error al obtener el resumen de WhatsApp:', error.response?.data || error.message);

//         if (error.response) {
//             // Si la API externa devuelve un error, reenviamos la respuesta original
//             res.status(error.response.status).json(error.response.data);
//         } else {
//             // Si hay un error de conexión u otro tipo, devolvemos un error genérico
//             res.status(500).json({ message: 'Error en el servidor o en la conexión a la API externa.' });
//         }
//     }
// });

// Ruta GET para obtener el resumen
app.get("/api/send-whatsapp/resumen", async (req, res) => {
  try {
    // Obtener el parámetro empresa de la consulta (query)
    const { empresa } = req.query;

    // Definir los parámetros para la solicitud a la API externa
    const params = {};

    if (empresa) {
      params.empresa = empresa; // Añadir el parámetro empresa si está definido
    }

    // Hacer la solicitud GET a la API externa, pasando los parámetros de consulta
    const response = await axios.get(
      `${EXTERNAL_API_BASE_URL}/api/sendwhatsapp/resumen`,
      { params }
    );
    // const response = await axios.get('http://10.10.10.10:5000/api/sendwhatsapp/resumen', { params });

    // Devolver la respuesta de la API externa
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(
      "Error al obtener el resumen de WhatsApp:",
      error.response?.data || error.message
    );

    if (error.response) {
      // Si la API externa devuelve un error, reenviamos la respuesta original
      res.status(error.response.status).json(error.response.data);
    } else {
      // Si hay un error de conexión u otro tipo, devolvemos un error genérico
      res.status(500).json({
        message: "Error en el servidor o en la conexión a la API externa.",
      });
    }
  }
});

app.post("/api/send-whatsapp/estado", async (req, res) => {
  const { idcampania, estado } = req.body;
  try {
    const response = await axios.post(
      `${EXTERNAL_API_BASE_URL}/api/sendwhatsapp/estado`,
      {
        idcampania: idcampania,
        estado: estado,
      }
    );
    const responseData = {
      message: response.data,
    };

    res.status(response.status).json(responseData);
  } catch (error) {
    console.error(
      "Error al cambiar de estado:",
      error.response?.data || error.message
    );
    res.status(400).json({
      message: error.response?.data.message || "Error al cambiar de estado.",
      status: 400,
    });
  }
});

// Ruta para eliminar una instancia
app.delete("/api/delete-instance/:instanceName", async (req, res) => {
  const { instanceName } = req.params;

  try {
    const response = await axios.delete(
      `${API_BASE_URL}/instance/delete/${instanceName}`,
      {
        headers: {
          apikey: API_KEY,
        },
      }
    );

    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(
      "Error al eliminar la instancia:",
      error.response?.data || error.message
    );
    res.status(error.response?.status || 400).json({
      message:
        error.response?.data?.message || "Error al eliminar la instancia.",
    });
  }
});

// Ruta para eliminar una instancia
app.delete("/api/delete-campaign/", async (req, res) => {
  const { instanceName } = req.body;

  try {
    const response = await axios.delete(
      `${API_BASE_URL}/instance/delete/${instanceName}`,
      {
        headers: {
          apikey: API_KEY,
        },
      }
    );

    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(
      "Error al eliminar la instancia:",
      error.response?.data || error.message
    );
    res.status(error.response?.status || 400).json({
      message:
        error.response?.data?.message || "Error al eliminar la instancia.",
    });
  }
});

// Ruta para cerrar la sesión de una instancia
app.delete("/api/logout-instance/:instanceName", async (req, res) => {
  const { instanceName } = req.params;

  try {
    const response = await axios.delete(
      `${API_BASE_URL}/instance/logout/${instanceName}`,
      {
        headers: {
          apikey: API_KEY,
        },
      }
    );

    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(
      "Error al cerrar la sesión de la instancia:",
      error.response?.data || error.message
    );
    res.status(error.response?.status || 400).json({
      message:
        error.response?.data?.message ||
        "Error al cerrar la sesión de la instancia.",
    });
  }
});

app.get("/api/generate-qr/:instanceName", async (req, res) => {
  const { instanceName } = req.params;

  try {
    const response = await axios.get(
      `${API_BASE_URL}/instance/connect/${instanceName}`,
      {
        headers: {
          apikey: API_KEY,
        },
      }
    );

    // Respuesta exitosa con status: 200
    const responseData = {
      base64: response.data.base64,
      status: 200,
    };

    res.status(200).json(responseData);
  } catch (error) {
    console.error("Error al generar el QR:", error);

    // Respuesta de error con status: 400
    res.status(400).json({
      message: error.response?.data.message || "Error al generar el QR.",
      status: 400,
    });
  }
});

// Ruta para reiniciar la instancia y generar un nuevo QR
app.get("/api/restart-qr/:instanceName", async (req, res) => {
  const { instanceName } = req.params;

  try {
    const response = await axios.post(
      `${API_BASE_URL}/instance/restart/${instanceName}`,
      {},
      {
        headers: {
          apikey: API_KEY,
        },
      }
    );

    // Respuesta exitosa con status: 200
    const responseData = {
      message: response.data.base64,
      status: 200,
    };

    res.status(200).json(responseData);
  } catch (error) {
    console.error(
      "Error al reiniciar la instancia:",
      error.response?.data || error.message
    );

    // Respuesta de error con status: 400
    res.status(400).json({
      message:
        error.response?.data.message || "Error al reiniciar la instancia.",
      status: 400,
    });
  }
});

// Ruta GET para obtener el resumen
app.get("/api/send-call/resumenCall", async (req, res) => {
  try {
    const response = await axios.get("http://5.161.42.50:3000/campaigns");

    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(
      "Error al obtener el resumen de WhatsApp:",
      error.response?.data || error.message
    );

    if (error.response) {
      // Si la API externa devuelve un error, reenviamos la respuesta original
      res.status(error.response.status).json(error.response.data);
    } else {
      // Si hay un error de conexión u otro tipo, devolvemos un error genérico
      res.status(500).json({
        message: "Error en el servidor o en la conexión a la API externa.",
      });
    }
  }
});

app.post("/api/send-call/startCall", async (req, res) => {
  const { campaign, numbers, audio_url } = req.body;
  try {
    const response = await axios.post("http://5.161.42.50:3000/start-call", {
      campaign: campaign,
      numbers: numbers,
      audio_url: audio_url,
    });
    const responseData = {
      message: response.data,
    };

    res.status(response.status).json(responseData);
  } catch (error) {
    console.error(
      "Error al cargar archivo:",
      error.response.data || error.message
    );
    res.status(400).json({
      message: error.response?.data.message || "Error al cargar archivo.",
      status: 400,
    });
  }
});

app.post("/api/login", async (req, res) => {
  const { idacceso, contraseña } = req.body;
  try {
    const response = await axios.post(
      "http://35.231.72.158:2025/api/Licencias/Login",
      {
        idacceso: idacceso,
        contraseña: contraseña,
        idempresas: "0",
        ipregistro: "0.0.0.0",
      }
    );
    const responseData = {
      message: response.data,
    };

    res.status(response.status).json(responseData);
  } catch (error) {
    console.error(
      "Error al iniciar sesión:",
      error.response?.data || error.message
    );
    res.status(400).json({
      message: error.response?.data.message || "Error al iniciar sesión.",
      status: 400,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
