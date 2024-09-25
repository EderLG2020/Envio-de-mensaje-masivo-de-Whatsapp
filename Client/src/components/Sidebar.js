import React from 'react';
import { NavLink } from 'react-router-dom';
import { AiOutlineDashboard, AiOutlineAppstore, AiOutlineThunderbolt, AiOutlineUser } from 'react-icons/ai';
import { FaCog, FaSignOutAlt } from 'react-icons/fa';
import './Sidebar.css';
import logo from '../assets/logo.png';

const Sidebar = () => {
    return (
        <div className="sidebar">
            <div className="sidebar-icons">
                <div className="sidebar-header">
                    <img src={logo} alt="WSP Masivo Logo" className="logo" />
                    <h4>WSP Masivo</h4>
                </div>
                <ul className="menu">
                    <li>
                        <NavLink
                            to="/"
                            className={({ isActive }) => isActive ? "menu-item active" : "menu-item"}
                        >
                            <AiOutlineDashboard />
                            <span>Dashboard</span>
                        </NavLink>
                    </li>
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
                        <li>
                            <NavLink
                                to="/profile"
                                className={({ isActive }) => isActive ? "menu-item active" : "menu-item"}
                            >
                                <AiOutlineUser />
                                <span>Perfil</span>
                            </NavLink>
                        </li>
                        <li>
                            <NavLink
                                to="/settings"
                                className={({ isActive }) => isActive ? "menu-item active" : "menu-item"}
                            >
                                <FaCog />
                                <span>Configuración</span>
                            </NavLink>
                        </li>
                        <li className="logout">
                            <NavLink
                                to="/logout"
                                className={({ isActive }) => isActive ? "menu-item active" : "menu-item"}
                            >
                                <FaSignOutAlt />
                                <span>Cerrar Sesión</span>
                            </NavLink>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    );
};

export default Sidebar;
