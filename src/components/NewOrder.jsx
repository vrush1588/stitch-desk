import { useEffect, useState } from "react";
import { generate, loadModel } from "../ai/gemma.js";
import {
  clearOrderDraft,
  getOrderDraft,
  saveOrder,
  saveOrderDraft,
} from "../utils/orders.js";

const emptyOrder = () => ({
  customer: "",
  garment: "",
  design_notes: "",
  delivery_date: "",
  total: "",
  advance: "",
  measurements: [],
  references: [],
});

function todayAsISODate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseOrderDraft(response) {
  const json = response
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    const parsed = JSON.parse(json);
    if (
      !parsed ||
      typeof parsed.customer !== "string" ||
      typeof parsed.garment !== "string" ||
      typeof parsed.design_notes !== "string" ||
      typeof parsed.delivery_date !== "string" ||
      (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.delivery_date) && parsed.delivery_date !== "") ||
      (parsed.total !== null && typeof parsed.total !== "number") ||
      (parsed.advance !== null && typeof parsed.advance !== "number") ||
      !parsed.measurements ||
      typeof parsed.measurements !== "object" ||
      Array.isArray(parsed.measurements) ||
      Object.values(parsed.measurements).some((value) => typeof value !== "number")
    ) {
      return null;
    }

    return {
      customer: parsed.customer,
      garment: parsed.garment,
      design_notes: parsed.design_notes,
      delivery_date: parsed.delivery_date,
      total: parsed.total === null ? "" : String(parsed.total),
      advance: parsed.advance === null ? "" : String(parsed.advance),
      measurements: Object.entries(parsed.measurements).map(([name, value]) => ({
        name,
        value: String(value),
      })),
    };
  } catch {
    return null;
  }
}

function NewOrderReference({ reference, index, onRemove }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="new-order-reference">
      {failed || !reference.thumbnail ? (
        <span className="new-order-reference-placeholder" role="img" aria-label={reference.title}>
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

function NewOrder({ onAIStatusChange }) {
  const [initialDraft] = useState(getOrderDraft);
  const [note, setNote] = useState(initialDraft?.note ?? "");
  const [order, setOrder] = useState(initialDraft?.order ?? emptyOrder());
  const [showForm, setShowForm] = useState(Boolean(initialDraft));
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");

  useEffect(() => {
    if (!showForm) {
      return;
    }
    try {
      saveOrderDraft({ note, order });
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
    }
  }, [note, order, showForm]);

  function updateField(field, value) {
    setOrder((current) => ({ ...current, [field]: value }));
  }

  function updateMeasurement(index, field, value) {
    setOrder((current) => ({
      ...current,
      measurements: current.measurements.map((measurement, rowIndex) =>
        rowIndex === index ? { ...measurement, [field]: value } : measurement,
      ),
    }));
  }

  async function handleCreateCard(event) {
    event.preventDefault();
    setIsCreating(true);
    setMessage("");
    setMessageType("");
    onAIStatusChange("loading");

    try {
      await loadModel();
      onAIStatusChange("ready");
      const prompt = [
        `Today's date is ${todayAsISODate()}.`,
        "Extract the order details from the note below and reply with JSON only, using exactly this shape:",
        '{"customer":"","garment":"","design_notes":"","measurements":{},"delivery_date":"YYYY-MM-DD or empty","total":number or null,"advance":number or null}.',
        "Never invent values. Use empty strings, an empty measurements object, or null for anything not in the note.",
        "Keep numbers exactly as written; do not calculate, round, or change their values.",
        'Put every body measurement in measurements as a name:number pair. For example, "chest 36, length 15" means {"chest":36,"length":15}; do not leave these values in design_notes.',
        "Design notes are construction and style details, not body measurements.",
        "For a delivery date without a year, use the next occurrence of that month and day relative to today's date.",
        `Order note: ${note}`,
      ].join(" ");
      const response = await generate(prompt);
      const parsedOrder = parseOrderDraft(response);

      if (!parsedOrder) {
        setOrder(emptyOrder());
        setShowForm(true);
        setMessage("AI is off, fill this in by hand");
        setMessageType("info");
        return;
      }

      setOrder(parsedOrder);
      setShowForm(true);
      setMessage("AI draft, please check");
      setMessageType("draft");
    } catch {
      onAIStatusChange("fallback");
      setOrder(emptyOrder());
      setShowForm(true);
      setMessage("AI is off, fill this in by hand");
      setMessageType("info");
    } finally {
      setIsCreating(false);
    }
  }

  function handleSaveOrder(event) {
    event.preventDefault();
    const savedMeasurements = Object.fromEntries(
      order.measurements
        .filter(({ name, value }) => name.trim() && value !== "")
        .map(({ name, value }) => [name.trim(), Number(value)]),
    );

    try {
      saveOrder({
        customer: order.customer.trim(),
        garment: order.garment.trim(),
        design_notes: order.design_notes.trim(),
        measurements: savedMeasurements,
        delivery_date: order.delivery_date,
        total: order.total === "" ? null : Number(order.total),
        advance: order.advance === "" ? null : Number(order.advance),
        references: order.references ?? [],
      });
      clearOrderDraft();
      setOrder(emptyOrder());
      setShowForm(false);
      setMessage("Order saved");
      setMessageType("success");
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
    }
  }

  const balance =
    order.total !== "" && order.advance !== ""
      ? Number(order.total) - Number(order.advance)
      : null;
  const missingCustomer = showForm && !order.customer.trim();
  const missingGarment = showForm && !order.garment.trim();
  const missingDeliveryDate = showForm && !order.delivery_date;

  return (
    <section className="new-order" aria-labelledby="new-order-title">
      <div className="new-order-heading">
        <div>
          <p className="eyebrow">ORDER WORKSPACE</p>
          <h2 id="new-order-title">New order</h2>
        </div>
        <span className="order-status">New</span>
      </div>

      <form className="order-note-form" onSubmit={handleCreateCard}>
        <label htmlFor="order-note">Order note</label>
        <textarea
          id="order-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Paste a customer message or jot down the order details..."
          rows={5}
        />
        <button className="primary-button" type="submit" disabled={isCreating}>
          {isCreating ? "Creating card..." : "Create card"}
        </button>
      </form>

      {!showForm && !message && (
        <div className="new-order-empty">
          <span className="empty-icon" aria-hidden="true">✦</span>
          <p>Paste a customer note above to start an order card. You can review and edit every detail before saving.</p>
        </div>
      )}

      {message && (
        <p className={`order-message order-message-${messageType}`} role="status">
          {message}
        </p>
      )}

      {showForm && (
        <form className="order-form" onSubmit={handleSaveOrder}>
          <div className="order-form-heading">
            <h3>Order details</h3>
            {messageType !== "draft" && <span className="order-status">New</span>}
          </div>

          <div className="order-fields">
            <label className={missingCustomer ? "is-required-missing" : ""}>
              Customer
              <input
                type="text"
                value={order.customer}
                onChange={(event) => updateField("customer", event.target.value)}
                aria-invalid={missingCustomer}
                required
              />
            </label>
            <label className={missingGarment ? "is-required-missing" : ""}>
              Garment
              <input
                type="text"
                value={order.garment}
                onChange={(event) => updateField("garment", event.target.value)}
                aria-invalid={missingGarment}
                required
              />
            </label>
            <label className={`field-wide ${missingDeliveryDate ? "is-required-missing" : ""}`}>
              Delivery date
              <input
                type="date"
                value={order.delivery_date}
                onChange={(event) => updateField("delivery_date", event.target.value)}
                aria-invalid={missingDeliveryDate}
                required
              />
            </label>
            <label className="field-wide">
              Design notes
              <textarea
                rows={3}
                value={order.design_notes}
                onChange={(event) => updateField("design_notes", event.target.value)}
              />
            </label>
          </div>

          <fieldset className="measurements-fieldset">
            <legend>Measurements</legend>
            {order.measurements.map((measurement, index) => (
              <div className="measurement-row" key={`${index}-${measurement.name}`}>
                <input
                  aria-label={`Measurement ${index + 1} name`}
                  placeholder="Name"
                  value={measurement.name}
                  onChange={(event) => updateMeasurement(index, "name", event.target.value)}
                />
                <input
                  aria-label={`Measurement ${index + 1} value`}
                  inputMode="decimal"
                  type="number"
                  step="any"
                  placeholder="Number"
                  value={measurement.value}
                  onChange={(event) => updateMeasurement(index, "value", event.target.value)}
                />
                <button
                  className="remove-measurement"
                  type="button"
                  aria-label={`Remove measurement ${index + 1}`}
                  onClick={() =>
                    updateField(
                      "measurements",
                      order.measurements.filter((_, rowIndex) => rowIndex !== index),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              className="secondary-button add-measurement"
              type="button"
              onClick={() =>
                updateField("measurements", [...order.measurements, { name: "", value: "" }])
              }
            >
              Add measurement
            </button>
          </fieldset>

          <div className="order-fields money-fields">
            <label>
              Total
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={order.total}
                onChange={(event) => updateField("total", event.target.value)}
              />
            </label>
            <label>
              Advance
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={order.advance}
                onChange={(event) => updateField("advance", event.target.value)}
              />
            </label>
            <div className="balance-field">
              <span>Balance</span>
              <output>{balance === null ? "—" : balance}</output>
            </div>
          </div>

          <section className="new-order-references" aria-labelledby="new-order-references-title">
            <div className="customer-section-title">
              <h3 id="new-order-references-title">Design references</h3>
              <span>{(order.references ?? []).length}/3</span>
            </div>
            {(order.references ?? []).length === 0 ? (
              <p className="reference-empty">Add references from the Designs tab.</p>
            ) : (
              <div className="new-order-reference-list">
                {order.references.map((reference, index) => (
                  <NewOrderReference
                    reference={reference}
                    index={index}
                    key={`${reference.link}-${index}`}
                    onRemove={(removeIndex) =>
                      updateField(
                        "references",
                        order.references.filter((_, referenceIndex) => referenceIndex !== removeIndex),
                      )
                    }
                  />
                ))}
              </div>
            )}
          </section>

          <button className="primary-button save-order-button" type="submit">
            Save order
          </button>
        </form>
      )}
    </section>
  );
}

export default NewOrder;
