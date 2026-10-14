import { useState } from "react";
import { loadModel } from "./ai/gemma.js";
import NewOrder from "./components/NewOrder.jsx";
import Orders from "./components/Orders.jsx";
import Customers from "./components/Customers.jsx";
import Designs from "./components/Designs.jsx";

const screens = [
  { id: "orders", label: "Orders", icon: "orders" },
  { id: "new", label: "New", icon: "new" },
  { id: "designs", label: "Designs", icon: "designs" },
  { id: "customers", label: "Customers", icon: "customers" },
];

function NewScreen({ onAIStatusChange }) {
  return <NewOrder onAIStatusChange={onAIStatusChange} />;
}

function TabIcon({ name }) {
  if (name === "new") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
  }
  if (name === "designs") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6 4-4 4 4-4 4M3 21l11-11M8 16l-4-4M14 10l-4-4" /></svg>;
  }
  if (name === "customers") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M18 8v6M15 11h6" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v3h3v15H4V6h3zM8 3v5h8V3M8 13h8M8 17h6" /></svg>;
}

function App() {
  const [activeTab, setActiveTab] = useState("orders");
  const [aiStatus, setAiStatus] = useState("fallback");
  const [aiMessage, setAiMessage] = useState("Connect to local Ollama to use the on-device AI.");

  function updateAIStatus(status) {
    setAiStatus(status);
    if (status === "loading") {
      setAiMessage("Connecting to Ollama on this device...");
    } else if (status === "ready") {
      setAiMessage("Connected to Ollama with gemma3:4b.");
    } else {
      setAiMessage("Local AI is off. The app remains available.");
    }
  }

  async function handleLoadModel() {
    setAiStatus("loading");
    setAiMessage("Connecting to Ollama on this device...");

    try {
      await loadModel();
      setAiStatus("ready");
      setAiMessage("Connected to Ollama with gemma3:4b.");
    } catch (error) {
      setAiStatus("fallback");
      setAiMessage(`${error.message} Local AI is off; the app remains available.`);
    }
  }

  const ActiveScreen = activeTab === "new"
    ? NewScreen
    : activeTab === "orders"
      ? Orders
      : activeTab === "customers"
        ? Customers
        : Designs;

  return (
    <main className="page">
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">S</span>
          <h1>Stitch Desk</h1>
        </div>
        <button
          className={`ai-badge ai-badge-${aiStatus}`}
          type="button"
          onClick={handleLoadModel}
          disabled={aiStatus === "loading" || aiStatus === "ready"}
          title={aiMessage}
          aria-label={`Local AI ${aiStatus === "ready" ? "on" : aiStatus === "loading" ? "connecting" : "off"}. ${aiMessage}`}
        >
          <span className="ai-indicator" aria-hidden="true" />
          Local AI {aiStatus === "ready" ? "on" : aiStatus === "loading" ? "connecting" : "off"}
        </button>
      </header>

      <ActiveScreen
        onAIStatusChange={updateAIStatus}
        onNewOrder={() => setActiveTab("new")}
      />

      <nav className="bottom-nav" aria-label="Main navigation">
        {screens.map(({ id, label, icon }) => (
          <button
            className="nav-item"
            type="button"
            aria-current={activeTab === id ? "page" : undefined}
            key={id}
            onClick={() => setActiveTab(id)}
          >
            <TabIcon name={icon} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </main>
  );
}

export default App;
