import React, { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  AiOutlineWhatsApp,
  AiOutlineAppstore,
  AiOutlineLogout,
  AiOutlinePhone,
} from "react-icons/ai";
import { IoMenu } from "react-icons/io5";
import "./Sidebar.css";
import logo from "../assets/logo.png";
import logoResponsive from "../assets/isotipo.png";

const Sidebar = () => {
  // Hook para redirigir
  const navigate = useNavigate();

  // Estado para el logo
  const [currentLogo, setCurrentLogo] = useState(logo);

  // Estado para mostar/ocultar el sidebar responsivo
  const [isSidebarVisible, setIsSidebarVisible] = useState(false);

  // Función para manejar el logout
  const handleLogout = () => {
    // Limpiar localStorage
    localStorage.clear(); // Borra todo el localStorage. Puedes usar removeItem('token') si solo quieres borrar el token.

    // Redirigir al usuario a la ruta raíz "/"
    navigate("/");
  };

  // useEffect para cambiar el logo dependiendo del tamaño de la pantalla
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 1000) {
        setCurrentLogo(logoResponsive);
      } else {
        setCurrentLogo(logo);
      }
    };

    // Ejecutar la función al cargar el componente
    handleResize();

    // Añadir un event listener para el evento "resize"
    window.addEventListener("resize", handleResize);

    // Limpiar el event listener cuando el componente se desmonte
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const toogleSideBar = () => {
    setIsSidebarVisible(!isSidebarVisible);
  };

  return (
    <div className={`sidebar ${isSidebarVisible ? "sidebar-visible" : ""}`}>
      <div className="box-ic-menu" onClick={toogleSideBar}>
        <IoMenu />
      </div>
      <div className="sidebar-icons">
        <div className="sidebar-header">
          <img src={currentLogo} alt="WSP Masivo Logo" className="logo" />
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
              className={({ isActive }) =>
                isActive ? "menu-item active" : "menu-item"
              }
            >
              <AiOutlineAppstore />
              <span>Instancias</span>
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/campanas"
              className={({ isActive }) =>
                isActive ? "menu-item active" : "menu-item"
              }
            >
              <AiOutlineWhatsApp />
              <span>Camp WSP</span>
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/campanasCall"
              className={({ isActive }) =>
                isActive ? "menu-item active" : "menu-item"
              }
            >
              <AiOutlinePhone />
              <span>Camp call</span>
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
              <button
                onClick={handleLogout}
                className="menu-item logout-button"
              >
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
