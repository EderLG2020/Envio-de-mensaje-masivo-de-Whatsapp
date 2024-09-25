import React, { useEffect, useRef } from 'react';
import './Modal.css';

const Modal = ({ isOpen, onClose, onSubmit, errorMessage, isSubmitting, children, title }) => {
    const [instanceName, setInstanceName] = React.useState('');
    const inputRef = useRef(null); // Creamos una referencia para el input

    const handleSubmit = () => {
        if (instanceName.trim()) {
            onSubmit(instanceName);
        }
    };

    const handleClose = () => {
        setInstanceName(''); // Limpiamos el campo cuando el modal se cierra
        onClose(); // Llamamos a onClose cuando se cierre el modal
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter') {
            handleSubmit(); // Llamamos a la función de envío cuando el usuario presiona "Enter"
        }
    };

    useEffect(() => {
        if (isOpen) {
            setInstanceName(''); // Limpiamos el campo cuando se abre el modal
            if (inputRef.current) {
                inputRef.current.focus(); // Colocamos el foco en el input cuando el modal se abra
            }
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                {/* Botón de cierre */}
                <button className="modal-close" onClick={handleClose}>
                    X
                </button>
                {/* Si hay un título dinámico, lo mostramos */}
                {title && <h3>{title}</h3>}
                {/* Si hay contenido dinámico (como el QR), lo mostramos aquí */}
                {children ? (
                    <div className="modal-children-content">
                        {children}
                    </div>
                ) : (
                    <>
                        <h3>Crear Nueva Instancia</h3>
                        <input
                            type="text"
                            placeholder="Nombre de la Instancia"
                            value={instanceName}
                            onChange={(e) => setInstanceName(e.target.value)}
                            onKeyPress={handleKeyPress} // Capturamos el evento "Enter"
                            ref={inputRef} // Asignamos la referencia al input
                        />
                        {errorMessage && <p className="error-message">{errorMessage}</p>}
                        <div className="modal-buttons">
                            <button className="btn btn-cancel" onClick={handleClose} disabled={isSubmitting}>
                                Cancelar
                            </button>
                            <button className="btn btn-confirm" onClick={handleSubmit} disabled={isSubmitting}>
                                {isSubmitting ? 'Creando...' : 'Crear'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default Modal;
