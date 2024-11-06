import React, { useEffect, useState } from "react";
import InstanceCard from "../components/InstanceCard";
import Spinner from "../components/Spinner";
import Modal from "../components/Modal";
import { fetchInstances, createInstance } from "../api";
import { FiRefreshCw } from "react-icons/fi";
import { AiOutlinePlus } from "react-icons/ai";
import "./Instancias.css";

function Instancias() {
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState("");

  const loadInstances = async () => {
    setLoading(true);
    try {
      const data = await fetchInstances();

      if (Array.isArray(data)) {
        const sortedInstances = data.sort(
          (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        );
        setInstances(sortedInstances);
      } else {
        console.error("La respuesta de fetchInstances no es un arreglo:", data);
        setInstances([]);
      }
    } catch (error) {
      console.error("Error loading instances:", error);
      setInstances([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateInstance = async (instanceName) => {
    setIsSubmitting(true);
    setModalError("");
    try {
      const response = await createInstance(instanceName);
      if (response.status === 200) {
        await loadInstances();
        setIsModalOpen(false);
      } else {
        setModalError("Ocurrió un error al crear la instancia.");
      }
    } catch (error) {
      if (error.response && error.response.status === 400) {
        setModalError(
          error.response.data.message || "Error al crear la instancia."
        );
      } else {
        setModalError(
          "Ocurrió un error al crear la instancia. Inténtalo nuevamente."
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInstanceDeleted = async () => {
    await loadInstances();
  };

  useEffect(() => {
    loadInstances();
  }, []);

  const handleModalClose = () => {
    setIsModalOpen(false);
    setModalError("");
  };

  const filteredInstances = instances.filter((instance) => {
    const matchesSearch = instance.name
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesStatus =
      statusFilter === "Todos" ||
      (statusFilter === "Conectado" && instance.connectionStatus === "open") ||
      (statusFilter === "Desconectado" &&
        (instance.connectionStatus === "close" ||
          instance.connectionStatus === "connecting"));
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="instancias-container">
      {loading && <Spinner />}
      <div className="toolbar">
        <h1>Instancias</h1>
        <div className="box-input" style={{ display: "flex", gap: "10px" }}>
          <input
            type="text"
            placeholder="Buscar"
            className="search-bar"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <button className="refresh-button" onClick={loadInstances}>
            <FiRefreshCw size={20} />
          </button>
        </div>
        <div className="box-options" style={{ display: "flex", gap: "10px" }}>
          <button className="add-button" onClick={() => setIsModalOpen(true)}>
            <AiOutlinePlus size={20} /> Instancia
          </button>
          <select
            className="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="Todos">Todos</option>
            <option value="Conectado">Conectado</option>
            <option value="Desconectado">Desconectado</option>
          </select>
        </div>
      </div>
      <div className="instance-grid">
        {!loading &&
          filteredInstances.map((instance) => (
            <InstanceCard
              key={instance.id}
              name={instance.name}
              status={
                instance.connectionStatus === "open"
                  ? "Conectado"
                  : "Desconectado"
              }
              connected={instance.connectionStatus === "open"}
              number1={instance._count.Message}
              number2={instance._count.Chat}
              phone={
                instance.ownerJid
                  ? instance.ownerJid.split("@")[0]
                  : "Sin número"
              }
              showQr={
                instance.connectionStatus === "close" ||
                instance.connectionStatus === "connecting"
              }
              profileName={instance.profileName}
              profilePicUrl={instance.profilePicUrl}
              onInstanceDeleted={handleInstanceDeleted}
            />
          ))}
      </div>
      <Modal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        onSubmit={handleCreateInstance}
        errorMessage={modalError}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}

export default Instancias;
