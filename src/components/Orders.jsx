import { useEffect, useState } from "react";
import { deleteOrder, getOrders, updateOrder } from "../utils/orders.js";

const statuses = ["New", "Stitching", "Trial pending", "Ready", "Delivered"];
const filters = [
  { id: "week", label: "This week" },
  { id: "all", label: "All orders" },
  { id: "delivered", label: "Delivered" },
];

function localDateFromISO(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

function dateDayNumber(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}

function todayDayNumber() {
  return dateDayNumber(new Date());
}

function deliveryOffset(order) {
  const deliveryDate = localDateFromISO(order.delivery_date);
  return deliveryDate ? dateDayNumber(deliveryDate) - todayDayNumber() : null;
}

function getDateChip(order) {
  const offset = deliveryOffset(order);
  if (offset === null) {
    return { label: "No delivery date", tone: "neutral" };
  }
  if (offset < 0) {
    return { label: "Overdue", tone: "urgent" };
  }
  if (offset === 1) {
    return { label: "Due tomorrow", tone: "urgent" };
  }
  if (offset <= 7) {
    return { label: "Due this week", tone: "soon" };
  }
  return { label: "Scheduled", tone: "neutral" };
}

function formatDeliveryDate(value) {
  const date = localDateFromISO(value);
  return date
    ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date)
    : "Date not set";
}

function getBalance(order) {
  return Number(order.total ?? 0) - Number(order.advance ?? 0);
}

function formatRupees(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function OrderReference({ reference, index, onRemove }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="order-reference">
      {failed || !reference.thumbnail ? (
        <span className="order-reference-placeholder" role="img" aria-label={reference.title}>
          {reference.title}
        </span>
      ) : (
        <img
          src={reference.thumbnail}
          alt={reference.title}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
      <span>{reference.source}</span>
      <button type="button" onClick={() => onRemove(index)}>Remove</button>
    </div>
  );
}

function OrderSheet({ order, onClose, onOrderUpdated, onOrderDeleted }) {
  const [status, setStatus] = useState(statuses.includes(order.status) ? order.status : "New");
  const [advance, setAdvance] = useState(order.advance ?? "");
  const [error, setError] = useState("");

  function handleSave(event) {
    event.preventDefault();
    const parsedAdvance = advance === "" ? null : Number(advance);
    if (parsedAdvance !== null && !Number.isFinite(parsedAdvance)) {
      setError("Enter a valid advance amount.");
      return;
    }
    try {
      const updated = updateOrder(order.id, { status, advance: parsedAdvance });
      onOrderUpdated(updated);
      onClose();
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  function handleDelete() {
    if (!window.confirm(`Delete the order for ${order.customer || "this customer"}? This cannot be undone.`)) {
      return;
    }
    try {
      deleteOrder(order.id);
      onOrderDeleted(order.id);
      onClose();
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  function handleRemoveReference(index) {
    try {
      const references = (order.references ?? []).filter((_, referenceIndex) => referenceIndex !== index);
      const updated = updateOrder(order.id, { references });
      onOrderUpdated(updated);
    } catch (removeError) {
      setError(removeError.message);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section
        className="order-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">ORDER DETAILS</p>
            <h2 id="order-sheet-title">{order.customer || "Order"}</h2>
            <p className="sheet-garment">{order.garment || "Garment not specified"}</p>
          </div>
          <button className="sheet-close" type="button" onClick={onClose} aria-label="Close order details">
            ×
          </button>
        </div>
        <form className="sheet-form" onSubmit={handleSave}>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {statuses.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label>
            Advance received (₹)
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={advance}
              onChange={(event) => setAdvance(event.target.value)}
            />
          </label>
          <div className="sheet-balance">
            <span>Balance pending</span>
            <strong>{formatRupees(Number(order.total ?? 0) - Number(advance || 0))}</strong>
          </div>
          {error && <p className="sheet-error" role="alert">{error}</p>}
          <button className="primary-button sheet-save" type="submit">Save changes</button>
          <button className="delete-order-button" type="button" onClick={handleDelete}>Delete order</button>
        </form>
        {(order.references ?? []).length > 0 && (
          <section className="order-sheet-references" aria-label="Design references">
            <h3>Design references</h3>
            <div className="order-reference-list">
              {order.references.map((reference, index) => (
                <OrderReference
                  reference={reference}
                  index={index}
                  key={`${reference.link}-${index}`}
                  onRemove={handleRemoveReference}
                />
              ))}
            </div>
          </section>
        )}
      </section>
    </div>
  );
}

function Orders({ onNewOrder }) {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState("week");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    try {
      setOrders(getOrders());
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const weekOrders = orders.filter((order) => {
    const offset = deliveryOffset(order);
    return offset !== null && offset >= 0 && offset <= 7 && order.status !== "Delivered";
  });
  const pendingBalance = orders
    .filter((order) => !["Delivered", "Paid"].includes(order.status))
    .reduce((sum, order) => sum + getBalance(order), 0);
  const visibleOrders = orders
    .filter((order) => {
      if (filter === "delivered") {
        return order.status === "Delivered";
      }
      if (filter === "week") {
        const offset = deliveryOffset(order);
        return order.status !== "Delivered" && offset !== null && offset >= 0 && offset <= 7;
      }
      return true;
    })
    .sort((first, second) => {
      const firstDate = first.delivery_date || "9999-12-31";
      const secondDate = second.delivery_date || "9999-12-31";
      return firstDate.localeCompare(secondDate);
    });

  return (
    <section className="orders-screen" aria-labelledby="orders-title">
      <div className="orders-heading">
        <div>
          <p className="eyebrow">YOUR WORKROOM</p>
          <h2 id="orders-title">Orders</h2>
        </div>
        <button className="floating-new-order" type="button" onClick={onNewOrder}>
          <span aria-hidden="true">+</span> New order
        </button>
      </div>

      <div className="order-summary">
        <article className="summary-card summary-due">
          <span>Due this week</span>
          <strong>{weekOrders.length}</strong>
          <small>{weekOrders.length === 1 ? "order" : "orders"}</small>
        </article>
        <article className="summary-card summary-balance">
          <span>Balance pending</span>
          <strong>{formatRupees(pendingBalance)}</strong>
          <small>excluding completed orders</small>
        </article>
      </div>

      <div className="order-filters" role="group" aria-label="Filter orders">
        {filters.map(({ id, label }) => (
          <button
            className="filter-chip"
            type="button"
            aria-pressed={filter === id}
            key={id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="screen-loading" role="status">
          <span className="loading-spinner" aria-hidden="true" />
          Loading your orders...
        </div>
      ) : loadError ? (
        <p className="orders-error" role="alert">{loadError}</p>
      ) : visibleOrders.length === 0 ? (
        <div className="orders-empty">
          <span className="empty-icon" aria-hidden="true">✦</span>
          <p>
            {orders.length === 0
              ? "No orders yet. Tap New order to add your first one."
              : filter === "week"
                ? "No orders due this week."
                : "No delivered orders yet."}
          </p>
          <button className="secondary-button" type="button" onClick={onNewOrder}>New order</button>
        </div>
      ) : (
        <div className="order-list" aria-label="Orders">
          {visibleOrders.map((order) => {
            const dateChip = getDateChip(order);
            return (
              <button
                className="order-card"
                type="button"
                key={order.id}
                onClick={() => setSelectedOrder(order)}
                aria-label={`${order.customer || "Order"}, ${order.garment || "garment not specified"}, ${order.status || "New"}, delivery ${formatDeliveryDate(order.delivery_date)}. Open order details.`}
              >
                <div className="order-card-top">
                  <div className="order-card-name">
                    <strong>{order.customer || "Customer not set"}</strong>
                    <span>{order.garment || "Garment not specified"}</span>
                  </div>
                  <span className={`status-chip status-${(order.status || "New").toLowerCase().replaceAll(" ", "-")}`}>
                    {order.status || "New"}
                  </span>
                </div>
                <p className="order-design-notes">{order.design_notes || "No design notes"}</p>
                <div className="order-card-bottom">
                  <div>
                    <span className={`delivery-chip delivery-${dateChip.tone}`}>{dateChip.label}</span>
                    <time dateTime={order.delivery_date || undefined}>
                      {formatDeliveryDate(order.delivery_date)}
                    </time>
                  </div>
                  <span className="order-card-balance">
                    Balance <strong>{formatRupees(getBalance(order))}</strong>
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedOrder && (
        <OrderSheet
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onOrderUpdated={(updated) => {
            setOrders((current) => current.map((order) => order.id === updated.id ? updated : order));
            setSelectedOrder(updated);
          }}
          onOrderDeleted={(id) => setOrders((current) => current.filter((order) => order.id !== id))}
        />
      )}
    </section>
  );
}

export default Orders;
