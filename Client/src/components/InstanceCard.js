import React, { useState, useEffect, useCallback } from 'react';
import { FaTrashAlt, FaQrcode } from 'react-icons/fa';
import './InstanceCard.css';
import peruFlag from '../assets/flags/peru.png';
import colombiaFlag from '../assets/flags/colombia.png';
import Spinner from './Spinner';
import Modal from './Modal';
import { logoutInstance, deleteInstance, checkInstanceExists, generateQrCode } from '../api';

function InstanceCard({ id, name, profileName, profilePicUrl, status, connected, phone, showQr, onInstanceDeleted }) {
    const [loading, setLoading] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [qrModalOpen, setQrModalOpen] = useState(false);
    const [qrCode, setQrCode] = useState(null);
    const [qrPolling, setQrPolling] = useState(null);

    let flag = null;
    if (connected) {
        if (phone.startsWith('51')) {
            flag = peruFlag;
        } else if (phone.startsWith('57')) {
            flag = colombiaFlag;
        }
    }

    const handleDelete = async () => {
        setLoading(true);
        setDeleting(true);

        try {
            if (connected) {
                const logoutResponse = await logoutInstance(name);
                if (logoutResponse.status !== 'SUCCESS') {
                    throw new Error('Error al cerrar la sesión de la instancia.');
                }
            }

            const deleteResponse = await deleteInstance(name);
            if (deleteResponse.status === 'SUCCESS') {
                let exists = true;
                while (exists) {
                    const instanceExists = await checkInstanceExists(name);
                    if (!instanceExists) {
                        exists = false;
                        await onInstanceDeleted();
                    }
                }
            } else {
                throw new Error('Error al eliminar la instancia.');
            }
        } catch (error) {
            console.error(error.message);
        } finally {
            setLoading(false);
            setDeleting(false);
        }
    };

    const handleQrClick = async () => {
        setLoading(true);
        try {
            const qrData = await generateQrCode(name);
            if (qrData.status === 200 && qrData.base64) {
                setQrCode(qrData.base64);
                setQrModalOpen(true);
                startQrPolling(); // Comenzamos el sondeo
            } else {
                console.error('Error en la respuesta del servidor al generar el QR.');
            }
        } catch (error) {
            console.error('Error al generar el QR:', error);
        } finally {
            setLoading(false);
        }
    };

    // Memorizar stopQrPolling
    const stopQrPolling = useCallback(() => {
        if (qrPolling) {
            clearInterval(qrPolling);
            setQrPolling(null);
        }
    }, [qrPolling]);

    // Iniciar el sondeo del QR
    const startQrPolling = () => {
        const polling = setInterval(async () => {
            try {
                const qrData = await generateQrCode(name);
                if (qrData.status === 200 && !qrData.base64) {
                    stopQrPolling(); // Detenemos el sondeo
                    setQrModalOpen(false); // Cerramos el modal
                    await onInstanceDeleted(); // Refrescamos las instancias
                }
            } catch (error) {
                console.error('Error durante el sondeo del QR:', error);
            }
        }, 5000);
        setQrPolling(polling); // Guardamos el ID del sondeo
    };

    const handleModalClose = () => {
        setQrModalOpen(false);
        setQrCode(null);
        stopQrPolling(); // Detenemos el sondeo cuando se cierre el modal
    };

    useEffect(() => {
        return () => {
            stopQrPolling(); // Limpiamos el sondeo cuando se desmonta el componente
        };
    }, [stopQrPolling]);

    return (
        <div className="instance-card-container">
            <div className="instance-card-background">
                <div className={`instance-card-content ${deleting ? 'deleting' : ''}`}>
                    <div className="instance-header">
                        <strong className="instance-name">{name}</strong>
                        {showQr && (
                            <button className="qr-button" onClick={handleQrClick} disabled={loading}>
                                {loading ? <Spinner size={20} /> : <FaQrcode size={20} />}
                            </button>
                        )}
                    </div>
                    <div className="profile-section">
                        {profilePicUrl ? (
                            <img src={profilePicUrl} alt="Profile" className="profile-pic" />
                        ) : (
                            <div className="default-pic">
                                {(profileName && profileName.charAt(0)) || (name && name.charAt(0)) || 'N/A'}
                            </div>
                        )}
                        <div className="instance-info">
                            <strong>{profileName || "Sin nombre"}</strong>
                            <span className="phone-number">{phone}</span>
                        </div>
                    </div>
                    <div className="instance-footer">
                        <div className="status-container">
                            <button className={connected ? 'connected' : 'disconnected'}>
                                {connected ? 'Conectada' : 'Desconectado'} <span className="status-indicator"></span>
                            </button>
                            {flag && <img src={flag} alt="flag" className="country-flag" />}
                        </div>
                        <button className="delete-button" onClick={handleDelete} disabled={loading}>
                            <FaTrashAlt size={16} />
                        </button>
                    </div>
                </div>
                {deleting && (
                    <div className="deleting-overlay">
                        <p>Eliminando instancia...</p>
                    </div>
                )}
            </div>

            <Modal isOpen={qrModalOpen} onClose={handleModalClose} title="Código QR de Conexión">
                {qrCode ? (
                    <img src={qrCode} alt="QR Code" className="qr-image" />
                ) : (
                    <p>Cargando código QR...</p>
                )}
            </Modal>
        </div>
    );
}

export default InstanceCard;
