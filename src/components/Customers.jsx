import { useEffect, useMemo, useState } from "react";
import { generate, loadModel } from "../ai/gemma.js";
import { getCustomerProfiles, saveCustomerProfile } from "../utils/customers.js";
import { getOrders } from "../utils/orders.js";

const statusClass = (status) => (status || "New").toLowerCase().replaceAll(" ", "-");

function customerKey(name) {
  return name.trim().toLocaleLowerCase();
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

function formatDate(value) {
  const date = validDate(value);
  return date
    ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date)
    : "Date not set";
}

function formatRupees(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function balancePending(order) {
  return Number(order.total ?? 0) - Number(order.advance ?? 0);
}

function latestMeasurements(orders) {
  const values = new Map();
  for (const order of orders) {
    const date = order.created_at || order.dateTime || "";
    for (const [name, value] of Object.entries(order.measurements ?? {})) {
      const normalizedName = name.trim().toLocaleLowerCase();
      if (!normalizedName || typeof value !== "number") {
        continue;
      }
      const existing = values.get(normalizedName);
      if (!existing || date > existing.date) {
        values.set(normalizedName, { name, value: String(value), date });
      }
    }
  }
  return [...values.values()].sort((first, second) =>
    first.name.localeCompare(second.name, undefined, { sensitivity: "base" }),
  );
}

function getCustomerMeasurements(orders, savedMeasurements) {
  const latest = latestMeasurements(orders);
  if (!Array.isArray(savedMeasurements)) {
    return latest;
  }
  if (savedMeasurements.length === 0) {
    return [];
  }

  const savedByName = new Map(
    savedMeasurements.map((measurement) => [
      measurement.name.trim().toLocaleLowerCase(),
      measurement,
    ]),
  );
  const latestNames = new Set(latest.map((measurement) => measurement.name.toLocaleLowerCase()));
  const merged = latest.map((measurement) => {
    const saved = savedByName.get(measurement.name.toLocaleLowerCase());
    return saved && String(saved.date ?? "") >= measurement.date ? saved : measurement;
  });
  for (const saved of savedMeasurements) {
    if (!latestNames.has(saved.name.trim().toLocaleLowerCase())) {
      merged.push(saved);
    }
  }
  return merged.sort((first, second) =>
    first.name.localeCompare(second.name, undefined, { sensitivity: "base" }),
  );
}

function groupOrders(orders, profiles) {
  const profileMap = new Map(profiles.map((profile) => [profile.key, profile]));
  const groups = new Map();
  for (const order of orders) {
    const name = typeof order.customer === "string" ? order.customer.trim() : "";
    if (!name) {
      continue;
    }
    const key = customerKey(name);
    if (!groups.has(key)) {
      groups.set(key, { key, name, orders: [], profile: profileMap.get(key) ?? {} });
    }
    groups.get(key).orders.push(order);
  }
  return [...groups.values()].map((customer) => ({
    ...customer,
    orders: customer.orders.sort((first, second) =>
      String(second.created_at || second.dateTime || "").localeCompare(
        String(first.created_at || first.dateTime || ""),
      ),
    ),
  }));
}

function replaceTemplateFactsAreIntact(template, reply) {
  const datePattern = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b/g;
  const dates = template.match(datePattern) ?? [];
  for (const date of dates) {
    if (!reply.includes(date)) {
      return false;
    }
  }

  const withoutDates = template.replace(datePattern, " ");
  const numbers = withoutDates.match(/₹?\d[\d,]*(?:\.\d+)?/g) ?? [];
  const replyNumbers = reply.match(/₹?\d[\d,]*(?:\.\d+)?/g) ?? [];
  return numbers.every((number) => replyNumbers.includes(number));
}

function messageTemplate(type, customer, order) {
  const name = customer.name;
  const garment = order.garment || "your order";
  const delivery = formatDate(order.delivery_date);
  const balance = formatRupees(balancePending(order));

  if (type === "Ready for trial") {
    return `Hi ${name}, your ${garment} is ready for a trial. Delivery date: ${delivery}. Balance: ${balance}. Please let me know a convenient time.`;
  }
  if (type === "Order ready") {
    return `Hi ${name}, your ${garment} is ready. Delivery date: ${delivery}. Balance: ${balance}. Please let me know when you would like to collect it.`;
  }
  return `Hi ${name}, a gentle reminder that the balance for your ${garment} is ${balance}. Delivery date: ${delivery}. Thank you!`;
}

function CustomerDetail({ customer, onBack, onProfileSaved, onAIStatusChange }) {
  const [phone, setPhone] = useState(customer.profile.phone ?? "");
  const [measurements, setMeasurements] = useState(() => {
    return getCustomerMeasurements(customer.orders, customer.profile.measurements);
  });
  const [selectedOrderId, setSelectedOrderId] = useState(customer.orders[0]?.id ?? "");
  const [messageText, setMessageText] = useState("");
  const [messageState, setMessageState] = useState("idle");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selectedOrder = customer.orders.find((order) => order.id === selectedOrderId) ?? customer.orders[0];
  const digitsOnlyPhone = phone.replace(/\D/g, "");

  function updateMeasurement(index, field, value) {
    setMeasurements((current) =>
      current.map((measurement, rowIndex) =>
        rowIndex === index ? { ...measurement, [field]: value } : measurement,
      ),
    );
  }

  function saveProfile(event) {
    event.preventDefault();
    setError("");
    try {
      const profile = saveCustomerProfile({
        ...customer.profile,
        key: customer.key,
        name: customer.name,
        phone: phone.trim(),
        measurements: measurements.map((measurement) => ({
          ...measurement,
          value: measurement.value,
        })),
      });
      onProfileSaved(profile);
      setNotice("Customer details saved.");
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  async function createMessage(type) {
    const template = messageTemplate(type, customer, selectedOrder);
    setMessageText(template);
    setMessageState("draft");
    setNotice("AI draft, please check");
    setError("");

    try {
      onAIStatusChange("loading");
      await loadModel();
      onAIStatusChange("ready");
      const reply = await generate(
        `${template}\n\nRewrite this message in a warm, polite, short tone, in English. Keep every number, date, and name exactly as written. Do not add new facts or prices. Reply with the message text only.`,
      );
      const cleanedReply = reply.trim();
      if (cleanedReply && replaceTemplateFactsAreIntact(template, cleanedReply)) {
        setMessageText(cleanedReply);
      } else {
        setMessageText(template);
      }
    } catch {
      onAIStatusChange("fallback");
      setMessageText(template);
    }
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(messageText);
      setNotice("Message copied.");
      setError("");
    } catch (copyError) {
      setError(`Unable to copy the message: ${copyError.message}`);
    }
  }

  function openWhatsApp() {
    if (!digitsOnlyPhone || !messageText) {
      return;
    }
    const url = `https://wa.me/${digitsOnlyPhone}?text=${encodeURIComponent(messageText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="customer-detail" aria-labelledby="customer-detail-title">
      <button className="back-button" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Customers
      </button>
      <header className="customer-detail-heading">
        <p className="eyebrow">CUSTOMER</p>
        <h2 id="customer-detail-title">{customer.name}</h2>
        <p>{customer.orders.length} {customer.orders.length === 1 ? "order" : "orders"}</p>
      </header>

      <form className="customer-profile-card" onSubmit={saveProfile}>
        <h3>Contact</h3>
        <label>
          Phone number
          <input
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="Add a phone number"
          />
        </label>

        <div className="customer-measurements">
          <div className="customer-section-title">
            <h3>Latest measurements</h3>
            <button
              className="text-action"
              type="button"
              onClick={() => setMeasurements((current) => [...current, { name: "", value: "", date: "" }])}
            >
              Add
            </button>
          </div>
          {measurements.length === 0 ? (
            <p className="customer-muted">No measurements saved yet.</p>
          ) : (
            <div className="customer-measurement-list">
              {measurements.map((measurement, index) => (
                <div className="customer-measurement-row" key={`${index}-${measurement.name}`}>
                  <input
                    aria-label={`Measurement ${index + 1} name`}
                    value={measurement.name}
                    placeholder="Name"
                    onChange={(event) => updateMeasurement(index, "name", event.target.value)}
                  />
                  <input
                    aria-label={`Measurement ${index + 1} value`}
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={measurement.value}
                    placeholder="Value"
                    onChange={(event) => updateMeasurement(index, "value", event.target.value)}
                  />
                  <span>{measurement.date ? formatDate(measurement.date.slice(0, 10)) : "Date not set"}</span>
                  <button
                    className="measurement-delete"
                    type="button"
                    aria-label={`Remove measurement ${index + 1}`}
                    onClick={() => setMeasurements((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="secondary-button save-customer-button" type="submit">Save customer</button>
      </form>

      <section className="customer-history" aria-labelledby="customer-history-title">
        <h3 id="customer-history-title">Order history</h3>
        <div className="customer-history-list">
          {customer.orders.map((order) => (
            <button
              className={`customer-history-item ${selectedOrderId === order.id ? "is-selected" : ""}`}
              type="button"
              key={order.id}
              onClick={() => setSelectedOrderId(order.id)}
            >
              <span className="customer-history-copy">
                <strong>{order.garment || "Garment not specified"}</strong>
                <small>{formatDate(order.delivery_date)}</small>
              </span>
              <span className={`status-chip status-${statusClass(order.status)}`}>{order.status || "New"}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="customer-message" aria-labelledby="customer-message-title">
        <div className="customer-section-title">
          <h3 id="customer-message-title">Message</h3>
          {messageState === "draft" && <span className="draft-label">AI draft, please check</span>}
        </div>
        <p className="message-context">
          Message details from {selectedOrder.garment || "this order"} · {formatDate(selectedOrder.delivery_date)} · {formatRupees(balancePending(selectedOrder))}
        </p>
        <div className="message-type-buttons">
          {["Ready for trial", "Order ready", "Balance reminder"].map((type) => (
            <button className="message-type-button" type="button" key={type} onClick={() => createMessage(type)}>
              {type}
            </button>
          ))}
        </div>
        <label className="message-editor-label" htmlFor="customer-message-text">Message text</label>
        <textarea
          id="customer-message-text"
          className="message-editor"
          rows={5}
          value={messageText}
          onChange={(event) => setMessageText(event.target.value)}
          placeholder="Choose a message type to create a draft."
        />
        <div className="message-actions">
          <button
            className="primary-button whatsapp-button"
            type="button"
            onClick={openWhatsApp}
            disabled={!digitsOnlyPhone || !messageText}
          >
            Open WhatsApp
          </button>
          <button className="secondary-button copy-button" type="button" onClick={copyMessage} disabled={!messageText}>
            Copy
          </button>
        </div>
        {!digitsOnlyPhone && <p className="phone-needed">Add a phone number first</p>}
        {notice && <p className="customer-notice" role="status">{notice}</p>}
        {error && <p className="customer-error" role="alert">{error}</p>}
      </section>
    </section>
  );
}

function Customers({ onAIStatusChange }) {
  const [orders, setOrders] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCustomerKey, setSelectedCustomerKey] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      setOrders(getOrders());
      setProfiles(getCustomerProfiles());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const customers = useMemo(() => groupOrders(orders, profiles), [orders, profiles]);
  const selectedCustomer = customers.find((customer) => customer.key === selectedCustomerKey);

  function handleProfileSaved(profile) {
    setProfiles((current) => [
      ...current.filter((saved) => saved.key !== profile.key),
      profile,
    ]);
  }

  if (error) {
    return <section className="customers-screen"><p className="customers-error" role="alert">{error}</p></section>;
  }

  if (isLoading) {
    return (
      <section className="customers-screen" aria-labelledby="customers-title">
        <header className="customers-heading">
          <p className="eyebrow">YOUR WORKROOM</p>
          <h2 id="customers-title">Customers</h2>
        </header>
        <div className="screen-loading" role="status">
          <span className="loading-spinner" aria-hidden="true" />
          Loading your customers...
        </div>
      </section>
    );
  }

  if (selectedCustomer) {
    return (
      <CustomerDetail
        customer={selectedCustomer}
        onBack={() => setSelectedCustomerKey("")}
        onProfileSaved={handleProfileSaved}
        onAIStatusChange={onAIStatusChange}
      />
    );
  }

  return (
    <section className="customers-screen" aria-labelledby="customers-title">
      <header className="customers-heading">
        <p className="eyebrow">YOUR WORKROOM</p>
        <h2 id="customers-title">Customers</h2>
      </header>
      {customers.length === 0 ? (
        <div className="customers-empty">
          <span className="empty-icon" aria-hidden="true">♡</span>
          <p>No customers yet. Customers will appear here when you save an order.</p>
        </div>
      ) : (
        <div className="customer-card-list">
          {customers.map((customer) => {
            const balance = customer.orders
              .filter((order) => !["Delivered", "Paid"].includes(order.status))
              .reduce((sum, order) => sum + balancePending(order), 0);
            return (
              <button
                className="customer-card"
                type="button"
                key={customer.key}
                onClick={() => setSelectedCustomerKey(customer.key)}
              >
                <span className="customer-avatar" aria-hidden="true">
                  {(customer.name[0] ?? "?").toLocaleUpperCase()}
                </span>
                <span className="customer-card-main">
                  <strong>{customer.name}</strong>
                  <small>{customer.profile.phone || "Phone not added"}</small>
                  <span>{customer.orders.length} {customer.orders.length === 1 ? "order" : "orders"}</span>
                </span>
                <span className="customer-card-balance">
                  <small>Balance pending</small>
                  <strong>{formatRupees(balance)}</strong>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default Customers;
