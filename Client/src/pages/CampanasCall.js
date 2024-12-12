import React, { useState, useRef, useEffect } from "react";
import "./CampanasCall.css";
import * as XLSX from "xlsx";
import {
  registerCamapaingCall,
  getCallSummary,
  deleteCampaignApi,
} from "../api";
import Swal from "sweetalert2";
import Spinner from "../components/Spinner";
import { MdDelete } from "react-icons/md";
import {
  FaCheckCircle,
  FaTimesCircle,
  FaClock,
  FaFileAudio,
  FaWindowClose,
  FaCircle,
  FaHourglassStart,
  FaRegFlag,
  FaFlagCheckered,
} from "react-icons/fa";

async function uploadAudioToApi(file) {
  const formData = new FormData();
  formData.append("bucket", "dify");
  formData.append("file", file, file.name);

  try {
    const response = await fetch("https://cloud.3w.pe/media", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();

    console.log(`Audio ${file.name} subido exitosamente: ${data.url}`);

    return data.url;
  } catch (error) {
    console.error(`Error subiendo el audio ${file.name}:`, error);
    throw error;
  }
}

function Campanas() {
  const [modalIsOpen, setModalIsOpen] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [rowCount, setRowCount] = useState(0);
  const [selectedFile, setSelectedFile] = useState(null);
  const [telefonosNombres, setTelefonosNombres] = useState([]);
  const [selectedAudio, setSelectedAudio] = useState(null);
  const [summaryData, setSummaryData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const inputRef = useRef(null);

  const [invalidNumbers, setInvalidNumbers] = useState([]);
  const [invalidDuplicates, setInvalidDuplicates] = useState([]);
  const [showInvalidModal, setShowInvalidModal] = useState(false);

  const fetchSummaryData = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const data = await getCallSummary();
      setSummaryData(
        data.sort(
          (a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion)
        )
      );
    } catch (error) {
      console.error("Error al obtener el resumen de campañas:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummaryData();
    const intervalId = setInterval(() => fetchSummaryData(false), 5000);
    return () => clearInterval(intervalId);
  }, []);

  const openModal = () => {
    setCampaignName("");
    setRowCount(0);
    setTelefonosNombres([]);
    setSelectedFile(null);
    setSelectedAudio(null);
    setInvalidNumbers([]);
    setInvalidDuplicates([]);
    setModalIsOpen(true);
  };

  const closeModal = () => {
    setCampaignName("");
    setRowCount(0);
    setTelefonosNombres([]);
    setSelectedFile(null);
    setSelectedAudio(null);
    setInvalidNumbers([]);
    setInvalidDuplicates([]);
    setModalIsOpen(false);
    setShowInvalidModal(false);
  };

  useEffect(() => {
    if (modalIsOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [modalIsOpen]);

  const handleNameChange = (e) => {
    setCampaignName(e.target.value);
  };

  // BLOQUE DE VALIDACIÓN EXCEL
  const handleExcelUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setSelectedFile(file);
    setRowCount(0);
    setTelefonosNombres([]);
    setInvalidNumbers([]);
    setInvalidDuplicates([]);

    const reader = new FileReader();
    reader.onload = (event) => {
      const data = new Uint8Array(event.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

      const allRows = rows.slice(1);
      const nonEmptyRows = allRows.filter((row) => row && row.length > 0);

      const validNumbers = [];
      const invalids = [];
      const duplicates = [];
      const seenNumbers = new Set();
      const seenInvalidNumbers = new Set();

      nonEmptyRows.forEach((row) => {
        if (row.length !== 1) {
          const invalidValue = row.join(",");
          if (seenInvalidNumbers.has(invalidValue)) {
            duplicates.push({
              value: invalidValue,
              error: "Más de una columna (duplicado)",
            });
          } else {
            invalids.push({ value: invalidValue, error: "Más de una columna" });
            seenInvalidNumbers.add(invalidValue);
          }
          return;
        }

        const value = String(row[0]).trim();
        const regex = /^9\d{8}$/;

        if (!regex.test(value)) {
          if (seenInvalidNumbers.has(value)) {
            duplicates.push({ value, error: "Formato inválido (duplicado)" });
          } else {
            invalids.push({ value, error: "Formato inválido" });
            seenInvalidNumbers.add(value);
          }
        } else {
          // Es válido
          if (!seenNumbers.has(value)) {
            validNumbers.push(value);
            seenNumbers.add(value);
          }
        }
      });

      setRowCount(validNumbers.length);
      setTelefonosNombres(validNumbers);
      setInvalidNumbers(invalids);
      setInvalidDuplicates(duplicates);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleAudioUpload = (e) => {
    const file = e.target.files[0];
    if (file && file.type === "audio/wav") {
      setSelectedAudio(file);
    } else {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Por favor, selecciona un archivo de audio válido (formato WAV).",
        background: "#111111",
        customClass: {
          popup: "my-swal-popup",
        },
      });
    }
  };

  const validateFields = () => {
    if (
      !campaignName ||
      (telefonosNombres.length === 0 &&
        invalidNumbers.length === 0 &&
        invalidDuplicates.length === 0)
    ) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Todos los campos deben estar completos y debes adjuntar un archivo válido.",
        customClass: {
          popup: "my-swal-popup",
        },
        background: "#111111",
      });
      closeModal();
      setLoading(false);
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    setLoading(true);
    if (!validateFields()) return;

    if (invalidNumbers.length > 0 || invalidDuplicates.length > 0) {
      setShowInvalidModal(true);
      setLoading(false);
      return;
    }

    await sendCampaign();
  };

  const sendCampaign = async (numbers = telefonosNombres) => {
    try {
      const audioUrl = await uploadAudioToApi(selectedAudio);
      await registerCamapaingCall(campaignName, numbers, audioUrl);
      closeModal();
      await fetchSummaryData(false);
      Swal.fire({
        icon: "success",
        title: "Éxito",
        text: "Campaña registrada con éxito",
        showConfirmButton: false,
        timer: 2000,
        background: "#111111",
        customClass: {
          popup: "my-swal-popup",
        },
      });
    } catch (error) {
      console.error("Error al registrar la campaña:", error);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Ocurrió un error al registrar la campaña. Inténtalo de nuevo.",
        background: "#111111",
        customClass: {
          popup: "my-swal-popup",
        },
      });
      closeModal();
    } finally {
      setLoading(false);
    }
  };

  const deleteCampaignFromAPI = async (itemId) => {
    try {
      const response = await deleteCampaignApi(itemId);
      return response;
    } catch (error) {
      console.error("Error al eliminar la campaña:", error);
      return {
        success: 3,
        message: "Error al conectar con la API. Intenta de nuevo.",
      };
    }
  };

  const deleteCampaign = async (item) => {
    const result = await Swal.fire({
      title: "¿Estás seguro?",
      text: "Esta acción eliminará el registro permanentemente, incluyendo los registros de llamada relacionados.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
      customClass: {
        popup: "my-swal-popup",
      },
      background: "#111111",
    });

    if (result.isConfirmed) {
      try {
        const { success, message } = await deleteCampaignFromAPI(item.id);

        console.log("success: ", success, "message: ", message);

        const swalOptions = {
          1: {
            title: "¡Eliminado!",
            text:
              message ||
              "El registro y sus llamadas relacionadas se eliminaron correctamente.",
            icon: "success",
          },
          2: {
            title: "Campaña no encontrada",
            text:
              message || "La campaña no fue encontrada o ya ha sido eliminada.",
            icon: "info",
          },
          3: {
            title: "Error",
            text:
              message || "No se pudo eliminar el registro. Intenta de nuevo.",
            icon: "error",
          },
        };

        await Swal.fire({
          ...(swalOptions[success] || {
            title: "Error desconocido",
            text: "Ocurrió un error inesperado. Intenta de nuevo.",
            icon: "error",
          }),
          timer: 2000,
          showConfirmButton: false,
          customClass: {
            popup: "my-swal-popup",
          },
          background: "#111111",
        });

        if (success === 1) {
          console.log("Eliminado correctamente: ", item.id);
        } else if (success === 2) {
          console.log("Campaña no encontrada o ya eliminada: ", item.id);
        } else {
          console.error("Error al eliminar: ", item.id);
        }
      } catch (error) {
        await Swal.fire({
          title: "Error",
          text: "No se pudo eliminar el registro. Inténtalo de nuevo.",
          icon: "error",
          timer: 2000,
          showConfirmButton: false,
          customClass: {
            popup: "my-swal-popup",
          },
          background: "#111111",
        });

        console.error("Error al eliminar: ", error);
      }
    } else {
      console.log("Eliminación cancelada.", item.id);
    }
  };

  const handleViewClick = (audioUrl) => {
    Swal.fire({
      title: "Reproducción",
      html: `<audio controls autoplay style="width: 100%;">
                <source src="${audioUrl}" type="audio/mpeg">
                Tu navegador no soporta la reproducción de audio.
             </audio>`,
      showCloseButton: true,
      showConfirmButton: false,
      customClass: {
        popup: "my-swal-popup",
      },
      background: "#111111",
    });
  };

  const handleContinueWithValid = async () => {
    setShowInvalidModal(false);
    await sendCampaign();
  };

  const handleCancelInvalid = () => {
    setShowInvalidModal(false);
  };

  return (
    <div className="dashboard-container">
      <div
        className="box-leyend-responsive"
        style={{ display: "none", gap: "10px" }}
      >
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
        <h1>Campañas Call</h1>
        <div className="box-leyend" style={{ display: "flex", gap: "20px" }}>
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
          <a href="/plantillaCall.xlsx" download>
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
                className={`card ${
                  item.sin_enviar === 0 ? "card-completed" : "card-sending"
                }`}
                key={index}
              >
                <div className="card-header">
                  <div className="box-data">
                    <div className="data-fecha">
                      <span className="fecha">
                        {new Date(item.fecha_creacion).toLocaleDateString()}
                      </span>
                      <span className="hora">
                        {new Date(item.fecha_creacion).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                  <div className="data-duration">
                    <FaHourglassStart />
                    <span className="status">
                      {parseFloat(item.promedio_duracion).toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="card-campaign-name d-flex">
                  <div className="containerItemNombre">
                    <h3 className="box-data">{item.nombre_campana} </h3>
                    <div
                      onClick={() => deleteCampaign(item)}
                      className="btnDelete"
                    >
                      <MdDelete />
                    </div>
                  </div>
                </div>
                <div className="box-view">
                  <div
                    className="view"
                    onClick={() => handleViewClick(item.audio_url)}
                  >
                    <p>Reproducir audio</p>
                    <FaFileAudio className="status-icon" />
                  </div>
                  <div
                    className={`content ${
                      expandedId === item.audio_url ? "show" : ""
                    }`}
                  ></div>
                </div>
                <div className="card-time">
                  <div className="box-data-card">
                    <FaRegFlag />
                    <div className="card-data">
                      <span className="fecha">
                        {new Date(item.fecha_envio_inicio).toLocaleDateString()}
                      </span>
                      <span className="hora">
                        {new Date(item.fecha_envio_inicio).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                  <div className="box-data-card">
                    {item.fecha_envio_fin != null ? (
                      <>
                        <FaFlagCheckered className="icon" />{" "}
                        <div className="card-data">
                          <span className="fecha">
                            {new Date(
                              item.fecha_envio_fin
                            ).toLocaleDateString()}
                          </span>
                          <span className="hora">
                            {new Date(
                              item.fecha_envio_fin
                            ).toLocaleTimeString()}
                          </span>
                        </div>
                      </>
                    ) : (
                      ""
                    )}
                  </div>
                </div>
                <div className="card-body">
                  <div className="status-group">
                    <div className="status-item pendiente">
                      <FaClock className="status-icon" /> {item.sin_enviar}
                    </div>
                    <div className="status-item success">
                      <FaCheckCircle className="status-icon" /> {item.enviados}
                    </div>
                    <div className="status-item error">
                      <FaTimesCircle className="status-icon" /> {item.fallidos}
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
                <label>Adjuntar Archivo Excel</label>
                <div className="file-input-wrapper">
                  <label className="file-input-label" htmlFor="excel-upload">
                    Seleccionar archivo
                  </label>
                  <input
                    type="file"
                    id="excel-upload"
                    onChange={handleExcelUpload}
                  />
                  <span className="file-selected">
                    {selectedFile
                      ? selectedFile.name
                      : "Sin archivos seleccionados"}
                  </span>
                </div>
                {rowCount > 0 && (
                  <p className="record-count">
                    Registros detectados: {rowCount}
                  </p>
                )}
              </div>

              <div className="form-group">
                <label>Adjuntar Audio (WAV)</label>
                <div className="file-input-wrapper">
                  <label className="file-input-label" htmlFor="audio-upload">
                    Seleccionar archivo
                  </label>
                  <input
                    type="file"
                    id="audio-upload"
                    onChange={handleAudioUpload}
                    accept="audio/wav"
                  />
                  <span className="file-selected">
                    {selectedAudio
                      ? selectedAudio.name
                      : "Sin archivos seleccionados"}
                  </span>
                </div>
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

      {showInvalidModal && (
        <div className="custom-modal-overlay">
          <div className="custom-modal">
            <div className="custom-modal-header">
              <h2>Filas Inválidas</h2>
              <button
                className="close-btn"
                onClick={() => setShowInvalidModal(false)}
              >
                <FaWindowClose />
              </button>
            </div>
            <div className="custom-modal-body">
              {invalidNumbers.length > 0 && (
                <>
                  <p>
                    Las siguientes filas no cumplen las condiciones (primera
                    vez):
                  </p>
                  <ul className="ItemNumberError">
                    {invalidNumbers.map((item, index) => (
                      <li key={index}>Número: {item.value}</li>
                    ))}
                  </ul>
                </>
              )}

              <div className="custom-modal-actions">
                <button
                  onClick={handleContinueWithValid}
                  className="guardar-btn"
                >
                  Continuar (omitir inválidos)
                </button>
                <button onClick={handleCancelInvalid} className="cancelar-btn">
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
