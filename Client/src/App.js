import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Instancias from './pages/Instancias';
import Campanas from './pages/Campanas';
import { ToastContainer } from 'react-toastify'; // Importa ToastContainer
import 'react-toastify/dist/ReactToastify.css'; // Importa los estilos de Toastify
import './App.css';

function App() {
  return (
    <Router>
      <div className="app-container">
        <Sidebar />
        <div className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/instancias" element={<Instancias />} />
            <Route path="/campanas" element={<Campanas />} />
          </Routes>
        </div>
        <ToastContainer /> {/* Añadir ToastContainer aquí */}
      </div>
    </Router>
  );
}

export default App;
