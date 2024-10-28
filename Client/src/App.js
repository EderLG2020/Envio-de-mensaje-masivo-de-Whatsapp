import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import Login from './pages/Login';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Instancias from './pages/Instancias';
import Campanas from './pages/Campanas';
import CampanasCall from './pages/CampanasCall';
import { ToastContainer } from 'react-toastify'; // Importa ToastContainer
import 'react-toastify/dist/ReactToastify.css'; // Importa los estilos de Toastify
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />

        <Route
          path="*"
          element={
            <div className="app-container">
              <Sidebar />
              <div className="main-content">
                <Routes>
                  {/* <Route path="/dashboard" element={<Dashboard />} /> */}
                  <Route path="/instancias" element={<Instancias />} />
                  <Route path="/campanas" element={<Campanas />} />
                  <Route path="/campanasCall" element={<CampanasCall />} />
                </Routes>
              </div>
              <ToastContainer /> {/* Añadir ToastContainer aquí */}
            </div>
          }
        />
      </Routes>
    </Router>
  );
}

export default App;
