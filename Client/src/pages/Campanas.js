import React, { useState, useRef, useEffect } from "react";
import "./Campanas.css";
import * as XLSX from "xlsx";
import { registerCampaign, getWhatsAppSummary, postWspState } from "../api";
import Swal from "sweetalert2";
import Spinner from "../components/Spinner";
import {
  FaCheckCircle,
  FaTimesCircle,
  FaClock,
  FaPause,
  FaEye,
  FaPlay,
  FaTrash,
  FaWindowClose,
  FaCircle,
} from "react-icons/fa";

function Campanas() {
  const [modalIsOpen, setModalIsOpen] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [campaignTitle, setCampaignTitle] = useState("");
  const [campaignText, setCampaignText] = useState("");
  const [rowCount, setRowCount] = useState(0);
  const [selectedType, setSelectedType] = useState("texto");
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedFileImagenVideo, setSelectedFileImagenVideo] = useState(null);
  const [media,setmedia]=useState("");
  const [telefonosNombres, setTelefonosNombres] = useState([]);
  const [summaryData, setSummaryData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const inputRef = useRef(null);

  // Función para obtener el resumen de campañas
  const fetchSummaryData = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const data = await getWhatsAppSummary();
      // Ordenar por fecha descendente
      setSummaryData(
        data.sort((a, b) => new Date(b.fechaHora) - new Date(a.fechaHora))
      );

      // Recorrer cada campaña para verificar si hay campañas que cumplan con la condición de pendiente === 0 y idestado === 4
      for (const campaign of data) {
        if (campaign.pendiente === 0 && campaign.idestado === 4) {
          try {
            // Actualizar el estado de la campaña a 5
            await postWspState(campaign.idcampania, 5);
            console.log(
              `Campaña ${campaign.idcampania} completada. Estado actualizado a 5.`
            );
          } catch (error) {
            console.error(
              `Error al actualizar el estado de la campaña ${campaign.idcampania}:`,
              error
            );
          }
        }
      }
    } catch (error) {
      console.error("Error al obtener el resumen de WhatsApp:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  // Llamar al API de resumen cada 20 segundos sin mostrar loading
  useEffect(() => {
    fetchSummaryData(); // Llamada inicial para cargar los datos con loading

    // Ejecutar la función cada 20 segundos sin mostrar loading
    const intervalId = setInterval(() => fetchSummaryData(false), 5000);

    // Limpiar el intervalo cuando el componente se desmonte
    return () => clearInterval(intervalId);
  }, []);

  const openModal = () => {
    setCampaignName("");
    setCampaignTitle("");
    setCampaignText("");
    setRowCount(0);
    setTelefonosNombres([]);
    setSelectedFile(null);
    setSelectedType("texto");
    setModalIsOpen(true);
    setSelectedFileImagenVideo(null)
  };

  const closeModal = () => {
    setCampaignName("");
    setCampaignTitle("");
    setCampaignText("");
    setRowCount(0);
    setTelefonosNombres([]);
    setSelectedFile(null);
    setSelectedType("texto");
    setModalIsOpen(false);
    setSelectedFileImagenVideo(null)
  };

  useEffect(() => {
    if (modalIsOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [modalIsOpen]);

  const handleNameChange = (e) => {
    setCampaignName(e.target.value);
  };

  const handleTitleChange = (e) => {
    setCampaignTitle(e.target.value);
  };

  const handleTextChange = (e) => {
    setCampaignText(e.target.value);
  };

  const handleTypeChange = (e) => {
    setSelectedType(e.target.value);
    
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    setmedia(file)
    setSelectedFileImagenVideo(file.name)
  };
  
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setSelectedFile(file.name);
    setRowCount(0); // Reinicia el contador de registros
    setTelefonosNombres([]); // Reinicia la lista de registros

    const reader = new FileReader();
    reader.onload = (event) => {
      const data = new Uint8Array(event.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet);

      // Asegurarse de que cada `Nevio` sea una cadena y si no tiene un nombre asignado, usar una cadena vacía
      const validRows = rows.filter((row) => row.Telefono); // Filtra solo por teléfono
      const telefonosNombresArray = validRows.map((row) => ({
        Tenvio: String(row.Telefono),
        Nevio: row.Nombre ? String(row.Nombre) : "", // Si 'Nombre' no existe, asignar una cadena vacía
      }));

      setRowCount(validRows.length);
      setTelefonosNombres(telefonosNombresArray);
    };
    reader.readAsArrayBuffer(file);
  };

  const validateFields = () => {
    if (!campaignName || !campaignTitle || !campaignText || rowCount === 0) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Todos los campos deben estar completos y debes adjuntar un archivo válido.",
        customClass: {
          popup: "my-swal-popup", // Añade una clase personalizada al modal
        },
        background: "#111111",
      });
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validateFields()) return;

    try {
      await registerCampaign(
        campaignName,
        campaignTitle,
        campaignText,
        selectedType,
        rowCount,
        telefonosNombres,
        media,
        setLoading
      );

      Swal.fire({
        icon: "success",
        title: "Éxito",
        text: "Campaña registrada con éxito",
        showConfirmButton: false,
        timer: 2000,
        background: "#111111",
        customClass: {
          popup: "my-swal-popup", // Añade una clase personalizada al modal
        },
      });

      closeModal();
      await fetchSummaryData(false); // Actualiza la pantalla en tiempo real sin mostrar loading
    } catch (error) {
      console.error("Error al registrar la campaña:", error);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Ocurrió un error al registrar la campaña. Inténtalo de nuevo.",
        background: "#111111",
        customClass: {
          popup: "my-swal-popup", // Añade una clase personalizada al modal
        },
      });
    }
  };

  const handleViewClick = (id) => {
    // Si el mismo card ya está expandido, colapsarlo; si no, expandirlo
    setExpandedId(expandedId === id ? null : id);
  };

  const changeStateCard = async (id, estado) => {
    try {
      const response = await postWspState(id, estado);
      Swal.fire({
        icon: "success",
        title: "Éxito",
        color: "#ffffff",
        background: "#111111",
        // text: `El estado de la campaña se ha cambiado exitosamente.`,
        showConfirmButton: false,
        timer: 2000,
        customClass: {
          popup: "my-swal-popup", // Añade una clase personalizada al modal
        },
      });
      await fetchSummaryData(false); // Refrescar los datos después de cambiar el estado
      console.log("Cambio exitoso", response.message);
    } catch (error) {
      Swal.fire({
        icon: "error",
        background: "#111111",
        title: "Error",
        // text: `Hubo un error al cambiar el estado de la campaña. Inténtalo de nuevo.`,
        customClass: {
          popup: "my-swal-popup", // Añade una clase personalizada al modal
        },
      });
      console.error("Error al cambiar el estado de la campaña:", error);
    }
  };

  const renderButtons = (id, estado) => {
    if (estado === 3) {
      // Renderizar en estado pausa
      return (
        <>
          <button onClick={() => changeStateCard(id, 3)}>
            <FaPlay className="status-icon" title="Reactivar Campaña" />
          </button>
          <button onClick={() => changeStateCard(id, 6)}>
            <FaTrash className="status-icon" title="Eliminar Campaña" />
          </button>
        </>
      );
    } else if (estado === 0 || estado === 4) {
      // Renderizar en estado pendiente y enviando
      return (
        <>
          <button onClick={() => changeStateCard(id, 0)}>
            <FaPause className="status-icon" title="Detener campaña" />
          </button>
          <button onClick={() => changeStateCard(id, 6)}>
            <FaTrash className="status-icon" title="Eliminar Campaña" />
          </button>
        </>
      );
    } else if (estado === 6) {
      // Renderizar en estado pausa
      return (
        <>
          <button onClick={() => changeStateCard(id, 3)}>
            <FaPlay className="status-icon" title="Reactivar Campaña" />
          </button>
        </>
      );
    } else if (estado === 5) {
      // Renderizar en estado pausa
      return (
        <>
          <button onClick={() => changeStateCard(id, 6)}>
            <FaTrash className="status-icon" title="Eliminar Campaña" />
          </button>
        </>
      );
    }
  };

  return (
    <div className="dashboard-container">
      {/* LEYENDA RESPOSIVO */}
      <div
        className="box-leyend-responsive"
        style={{ display: "none", gap: "10px" }}
      >
        <div
          className="leyend-pause"
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <FaCircle />
          <p>Pausa</p>
        </div>
        <div
          className="leyend-send"
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <FaCircle />
          <p>Pendiente</p>
        </div>
        {/* <div className='leyend-cancel' style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }} >
                        <FaCircle />
                        <p>Cancelar</p>
                    </div> */}
        <div
          className="leyend-sending"
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <FaCircle />
          <p>Enviando</p>
        </div>
        <div
          className="leyend-finalized"
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <FaCircle />
          <p>Finalizado</p>
        </div>
      </div>

      <div className="header">
        <h1>Campañas WSP</h1>
        <div className="box-leyend" style={{ display: "flex", gap: "20px" }}>
          <div
            className="leyend-pause"
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <FaCircle />
            <p>Pausa</p>
          </div>
          <div
            className="leyend-send"
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <FaCircle />
            <p>Pendiente</p>
          </div>
          {/* <div className='leyend-cancel' style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }} >
                        <FaCircle />
                        <p>Cancelar</p>
                    </div> */}
          <div
            className="leyend-sending"
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <FaCircle />
            <p>Enviando</p>
          </div>
          <div
            className="leyend-finalized"
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <FaCircle />
            <p>Finalizado</p>
          </div>
        </div>
        <div className="button-group">
          <button onClick={openModal} className="crear-campana-btn">
            Crear Campaña
          </button>
          <a href="/plantilla.xlsx" download>
            <button className="descargar-btn">Descargar Plantilla</button>
          </a>
        </div>
      </div>
      {loading ? (
        <Spinner />
      ) : (
        <div className="cards-container">
          {summaryData.length > 0 ? (
            summaryData.map((item, index) => (
              <div
                className={`card ${item.idestado === 3
                  ? "card-pause"
                  : item.idestado === 0
                    ? "card-pending"
                    : item.idestado === 6
                      ? "card-cancel"
                      : item.idestado === 4
                        ? "card-sending"
                        : item.idestado === 5
                          ? "card-completed"
                          : ""
                  }`}
                key={index}
              >
                <div className="card-header">
                  <div className="box-data">
                    <span className="fecha">
                      {new Date(item.fechaHora).toLocaleDateString()}
                    </span>
                    <span className="hora">
                      {new Date(item.fechaHora).toLocaleTimeString()}
                    </span>
                  </div>
                  {/* Condiciones para renderizar botones en card */}
                  <div className="box-buttons">
                    {renderButtons(item.idcampania, item.idestado)}
                  </div>
                </div>
                <div className="card-campaign-name">
                  <h3>{item.campania}</h3>
                </div>
                <div className="box-view">
                  <div
                    className="view"
                    onClick={() => handleViewClick(item.idcampania)}
                  >
                    <p>Ver contenido</p>
                    <FaEye className="status-icon" />
                  </div>
                  {/* Contenido que se expande al hacer clic */}
                  <div
                    className={`content ${expandedId === item.idcampania ? "show" : ""
                      }`}
                  >
                    {item.mensaje}
                  </div>
                </div>
                <div className="card-body">
                  <div className="status-group">
                    <div className="status-item pendiente">
                      <FaClock className="status-icon" /> {item.pendiente}
                    </div>
                    <div className="status-item success">
                      <FaCheckCircle className="status-icon" /> {item.enviado}
                    </div>
                    <div className="status-item error">
                      <FaTimesCircle className="status-icon" /> {item.error}
                    </div>
                    <div className="status-item total">
                      <span className="total-label">Total</span>
                      <span className="total-number">{item.total}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p>No se encontraron datos de campañas.</p>
          )}
        </div>
      )}

      {modalIsOpen && (
        <div className="custom-modal-overlay">
          <div className="custom-modal">
            <div className="custom-modal-header">
              <h2>Crear Campaña</h2>
              <button className="close-btn" onClick={closeModal}>
                <FaWindowClose />
              </button>
            </div>

            <div className="custom-modal-body">
              <div className="form-group">
                <label htmlFor="campaignName">Nombre de la Campaña</label>
                <input
                  type="text"
                  id="campaignName"
                  placeholder="Nombre de la Campaña"
                  value={campaignName}
                  onChange={handleNameChange}
                  className="input-field"
                  ref={inputRef}
                />
              </div>

              <div className="form-group">
                <label htmlFor="campaignTitle">Título de la Campaña</label>
                <input
                  type="text"
                  id="campaignTitle"
                  placeholder="Título de la Campaña"
                  value={campaignTitle}
                  onChange={handleTitleChange}
                  className="input-field"
                />
              </div>

              <div className="form-group">
                <label htmlFor="campaignText">Contenido de la Campaña</label>
                <textarea
                  id="campaignText"
                  value={campaignText}
                  onChange={handleTextChange}
                  maxLength={500}
                  placeholder="Escribe el contenido de tu campaña"
                  className="textarea-field"
                />
                <p className="char-counter">
                  {campaignText.length}/500 caracteres
                </p>
              </div>

              <div className="form-group">
                <label>Adjuntar Archivo Excel</label>
                <div className="file-input-wrapper">
                  <label className="file-input-label" htmlFor="file-upload">
                    Seleccionar archivo
                  </label>
                  <input
                    type="file"
                    id="file-upload"
                    onChange={handleFileUpload}
                  />
                  <span className="file-selected">
                    {selectedFile || "Sin archivos seleccionados"}
                  </span>
                </div>
                {rowCount > 0 && (
                  <p className="record-count">
                    Registros detectados: {rowCount}
                  </p>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="tipo">Tipo de Campaña</label>
                <select
                  id="tipo"
                  value={selectedType}
                  onChange={handleTypeChange}
                  className="select-field"
                >
                  <option value="texto">Texto</option>
                  <option value="imagen">Imagen</option>
                  <option value="video">Video</option>
                </select>

                {(selectedType === "imagen" || selectedType === "video") && (
                  <div className="divfileInputImagenVideo">
                    <label
                      className="fileInputImagenVideo"
                      htmlFor="file-upload-imagen-video"
                      style={{ cursor: "pointer" }}
                    >
                      Cargar {selectedType}
                    </label>
                    <input
                      onChange={handleFileChange}
                      type="file"
                      id="file-upload-imagen-video"
                      accept={selectedType === 'imagen' ? "image/jpeg" : selectedType === 'video' ? "video/mp4" : ""}
                    />
                    <span className="file-selected">
                      {selectedFileImagenVideo || "Sin archivos seleccionados"}
                    </span>
                  </div>
                )}
              </div>

              <div className="custom-modal-actions">
                <button onClick={handleSubmit} className="guardar-btn">
                  Enviar
                </button>
                <button onClick={closeModal} className="cancelar-btn">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Campanas;
