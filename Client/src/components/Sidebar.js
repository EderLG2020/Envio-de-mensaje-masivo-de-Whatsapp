import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { AiOutlineDashboard, AiOutlineAppstore, AiOutlineThunderbolt, AiOutlineLogout } from 'react-icons/ai';
import { FaCog, FaSignOutAlt } from 'react-icons/fa';
import './Sidebar.css';
import logo from '../assets/logo.png';

const Sidebar = () => {
    // Hook para redirigir
    const navigate = useNavigate();

    // Función para manejar el logout
    const handleLogout = () => {
        // Limpiar localStorage
        localStorage.clear(); // Borra todo el localStorage. Puedes usar removeItem('token') si solo quieres borrar el token.

        // Redirigir al usuario a la ruta raíz "/"
        navigate('/');
    };


    return (
        <div className="sidebar">
            <div className="sidebar-icons">
                <div className="sidebar-header">
                    <img src={logo} alt="WSP Masivo Logo" className="logo" />
                    <h4>Masivo</h4>
                </div>
                <ul className="menu">
                    {/* <li>
                        <NavLink
                            to="/dashboard"
                            className={({ isActive }) => isActive ? "menu-item active" : "menu-item"}
                        >
                            <AiOutlineDashboard />
                            <span>Dashboard</span>
                        </NavLink>
                    </li> */}
                    <li>
                        <NavLink
                            to="/instancias"
                            className={({ isActive }) => isActive ? "menu-item active" : "menu-item"}
                        >
                            <AiOutlineAppstore />
                            <span>Instancias</span>
                        </NavLink>
                    </li>
                    <li>
                        <NavLink
                            to="/campanas"
                            className={({ isActive }) => isActive ? "menu-item active" : "menu-item"}
                        >
                            <AiOutlineThunderbolt />
                            <span>Campañas</span>
                        </NavLink>
                    </li>
                </ul>
                <div className="bottom-section">
                    <ul className="menu">
                        {/* <li>
                            <NavLink
                                to="/profile"
                                className={({ isActive }) => isActive ? "menu-item active" : "menu-item"}
                            >
                                <AiOutlineUser />
                                <span>Perfil</span>
                            </NavLink>
                        </li> */}
                        {/* <li>
                            <NavLink
                                to="/settings"
                                className={({ isActive }) => isActive ? "menu-item active" : "menu-item"}
                            >
                                <FaCog />
                                <span>Configuración</span>
                            </NavLink>
                        </li> */}
                        <li className="logout">
                            <button onClick={handleLogout} className="menu-item logout-button">
                                <AiOutlineLogout />
                                <span>Cerrar Sesión</span>
                            </button>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    );
};

export default Sidebar;
