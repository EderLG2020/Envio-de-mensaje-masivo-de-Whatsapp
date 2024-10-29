import React, { useState, useRef, useEffect } from 'react';
import './CampanasCall.css';
import * as XLSX from 'xlsx';
import { registerCamapaingCall, getCallSummary } from '../api';
import Swal from 'sweetalert2';
import Spinner from '../components/Spinner';
import { FaCheckCircle, FaTimesCircle, FaClock, FaPause, FaFileAudio, FaPlay, FaTrash, FaWindowClose, FaCircle, FaHourglassStart, FaRegFlag, FaFlagCheckered } from 'react-icons/fa';

// Función para subir una imagen (en este caso, un archivo de audio) a la API y devolver la URL
async function uploadAudioToApi(file) {
    const formData = new FormData();
    formData.append('bucket', 'dify');
    formData.append('file', file, file.name);

    try {
        const response = await fetch('https://cloud.3w.pe/media', {
            method: 'POST',
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
    const [campaignName, setCampaignName] = useState('');
    const [rowCount, setRowCount] = useState(0);
    const [selectedFile, setSelectedFile] = useState(null);
    const [telefonosNombres, setTelefonosNombres] = useState([]);
    const [selectedAudio, setSelectedAudio] = useState(null); // Estado para el archivo de audio
    const [summaryData, setSummaryData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState(null);
    const inputRef = useRef(null);

    // Función para obtener el resumen de campañas
    const fetchSummaryData = async (showLoading = true) => {
        if (showLoading) setLoading(true);
        try {
            const data = await getCallSummary();
            setSummaryData(data.sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion)));
        } catch (error) {
            console.error('Error al obtener el resumen de campañas:', error);
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
        setCampaignName('');
        setRowCount(0);
        setTelefonosNombres([]);
        setSelectedFile(null);
        setSelectedAudio(null);
        setModalIsOpen(true);
    };

    const closeModal = () => {
        setCampaignName('');
        setRowCount(0);
        setTelefonosNombres([]);
        setSelectedFile(null);
        setSelectedAudio(null);
        setModalIsOpen(false);
    };

    useEffect(() => {
        if (modalIsOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [modalIsOpen]);

    const handleNameChange = (e) => {
        setCampaignName(e.target.value);
    };

    // Controlador para manejar la carga del archivo Excel
    const handleExcelUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setSelectedFile(file); // Guardar el archivo completo, no solo el nombre
        setRowCount(0);
        setTelefonosNombres([]);

        const reader = new FileReader();
        reader.onload = (event) => {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }); // Obtener todas las filas como matriz

            // Filtrar solo las filas a partir de la fila 2 (es decir, omitir el encabezado)
            const validRows = rows.slice(1).filter(row => row[0]); // Saltar la primera fila y filtrar filas vacías

            // Crear un array con el número de fila y el número de teléfono alternados
            const telefonosNombresArray = [];
            validRows.forEach((row) => {
                // const filaNumero = index + 2; // Index + 2 para reflejar la fila real en el Excel
                // telefonosNombresArray.push(String(filaNumero)); // Número de la fila como string
                telefonosNombresArray.push(String(row[0])); // Teléfono como string
            });

            setRowCount(validRows.length);
            setTelefonosNombres(telefonosNombresArray);
        };
        reader.readAsArrayBuffer(file);
    };

    const handleAudioUpload = (e) => {
        const file = e.target.files[0];
        if (file && file.type === "audio/wav") { // Validar que sea un archivo WAV
            setSelectedAudio(file);
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Por favor, selecciona un archivo de audio válido (formato WAV).',
                background: '#111111',
                customClass: {
                    popup: 'my-swal-popup'
                }
            });
        }
    };

    const validateFields = () => {
        if (!campaignName || rowCount === 0) {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Todos los campos deben estar completos y debes adjuntar un archivo válido.',
                customClass: {
                    popup: 'my-swal-popup' // Añade una clase personalizada al modal
                },
                background: '#111111'
            });
            return false;
        }
        return true;
    };

    const handleSubmit = async () => {
        if (!validateFields()) return;

        try {

            // Subir el archivo de audio al bucket antes de registrar la campaña
            const audioUrl = await uploadAudioToApi(selectedAudio);

            // Llamar a la API para registrar la campaña
            await registerCamapaingCall(
                campaignName,
                // rowCount,
                telefonosNombres,
                audioUrl // Enviando el archivo de audio
            );

            Swal.fire({
                icon: 'success',
                title: 'Éxito',
                text: 'Campaña registrada con éxito',
                showConfirmButton: false,
                timer: 2000,
                background: '#111111',
                customClass: {
                    popup: 'my-swal-popup'
                }
            });

            closeModal();
            await fetchSummaryData(false);
        } catch (error) {
            console.error('Error al registrar la campaña:', error);
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Ocurrió un error al registrar la campaña. Inténtalo de nuevo.',
                background: '#111111',
                customClass: {
                    popup: 'my-swal-popup'
                }
            });
        }
    };

    const handleViewClick = (audioUrl) => {
        Swal.fire({
            title: 'Reproducción',
            html: `<audio controls autoplay style="width: 100%;">
                      <source src="${audioUrl}" type="audio/mpeg">
                      Tu navegador no soporta la reproducción de audio.
                   </audio>`,
            showCloseButton: true,
            showConfirmButton: false,
            customClass: {
                popup: 'my-swal-popup' // Añade una clase personalizada al modal
            },
            background: '#111111'
        });
    };


    return (
        <div className="dashboard-container">

            {/* LEYENDA RESPOSIVO */}
            <div className='box-leyend-responsive' style={{ display: 'none', gap: '10px' }} >
                <div className='leyend-sending' style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }} >
                    <FaCircle />
                    <p>Enviando</p>
                </div>
                <div className='leyend-finalized' style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }} >
                    <FaCircle />
                    <p>Finalizado</p>
                </div>
            </div>

            <div className="header">
                <h1>Campañas Call</h1>
                <div className='box-leyend' style={{ display: 'flex', gap: '20px' }} >
                    <div className='leyend-sending' style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }} >
                        <FaCircle />
                        <p>Enviando</p>
                    </div>
                    <div className='leyend-finalized' style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }} >
                        <FaCircle />
                        <p>Finalizado</p>
                    </div>
                </div>
                <div className="button-group">
                    <button onClick={openModal} className="crear-campana-btn">Crear Campaña</button>
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
                                className={`card ${item.sin_enviar === 0 ? 'card-completed' : 'card-sending'}`}
                                key={index}
                            >
                                <div className="card-header">
                                    <div className='box-data'>
                                        <div className='data-fecha'>
                                            <span className="fecha">{new Date(item.fecha_creacion).toLocaleDateString()}</span>
                                            <span className="hora">{new Date(item.fecha_creacion).toLocaleTimeString()}</span>
                                        </div>
                                    </div>
                                    <div className='data-duration'>
                                        <FaHourglassStart />
                                        <span className="status">{parseFloat(item.promedio_duracion).toFixed(2)}</span>
                                    </div>
                                </div>
                                <div className="card-campaign-name">
                                    <h3>{item.nombre_campana}</h3>
                                </div>
                                <div className="box-view">
                                    <div className='view' onClick={() => handleViewClick(item.audio_url)}>
                                        <p>Reproducir audio</p>
                                        <FaFileAudio className="status-icon" />
                                    </div>
                                    {/* Contenido que se expande al hacer clic */}
                                    <div className={`content ${expandedId === item.audio_url ? 'show' : ''}`}>
                                        {/* {item.mensaje} */}
                                    </div>
                                </div>
                                <div className='card-time'>
                                    <div className='box-data-card'>
                                        <FaRegFlag />
                                        <div className='card-data'>
                                            <span className="fecha">{new Date(item.fecha_envio_inicio).toLocaleDateString()}</span>
                                            <span className="hora">{new Date(item.fecha_envio_inicio).toLocaleTimeString()}</span>
                                        </div>
                                    </div>
                                    <div className='box-data-card'>
                                        <FaFlagCheckered />
                                        <div className='card-data'>
                                            <span className="fecha">{new Date(item.fecha_envio_fin).toLocaleDateString()}</span>
                                            <span className="hora">{new Date(item.fecha_envio_fin).toLocaleTimeString()}</span>
                                        </div>
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
                                    <label className="file-input-label" htmlFor="excel-upload">Seleccionar archivo</label>
                                    <input type="file" id="excel-upload" onChange={handleExcelUpload} />
                                    <span className="file-selected">
                                        {selectedFile ? selectedFile.name : 'Sin archivos seleccionados'}
                                    </span>
                                </div>
                                {rowCount > 0 && <p className="record-count">Registros detectados: {rowCount}</p>}
                            </div>

                            <div className="form-group">
                                <label>Adjuntar Audio (WAV)</label>
                                <div className="file-input-wrapper">
                                    <label className="file-input-label" htmlFor="audio-upload">Seleccionar archivo</label>
                                    <input type="file" id="audio-upload" onChange={handleAudioUpload} accept="audio/wav" />
                                    <span className="file-selected">
                                        {selectedAudio ? selectedAudio.name : 'Sin archivos seleccionados'}
                                    </span>
                                </div>
                            </div>

                            <div className="custom-modal-actions">
                                <button onClick={handleSubmit} className="guardar-btn">Enviar</button>
                                <button onClick={closeModal} className="cancelar-btn">Cancelar</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Campanas;
