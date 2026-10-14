import { useEffect, useState } from "react";
import { searchDesigns } from "../ai/designSearch.js";
import {
  getOrderDraft,
  getOrders,
  saveOrderDraft,
  updateOrder,
} from "../utils/orders.js";

function ImageOrPlaceholder({ result, className = "" }) {
  const [failed, setFailed] = useState(false);
  if (!result.thumbnail || failed) {
    return (
      <span className={`design-image-placeholder ${className}`} role="img" aria-label={result.title}>
        {result.title || "Image unavailable"}
      </span>
    );
  }
  return (
    <img
      className={className}
      src={result.thumbnail}
      alt={result.title}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function getSearchErrorMessage(error) {
  if (error.message?.includes("Search limit reached")) {
    return "Search limit reached for now";
  }
  if (error instanceof TypeError || /failed to fetch|networkerror|fetch failed/i.test(error.message ?? "")) {
    return "Search is offline, you can still add notes by hand";
  }
  return error.message || "Design search failed. Please try again.";
}

function ReferencesList({ references, onRemove }) {
  if (references.length === 0) {
    return <p className="reference-empty">No references attached.</p>;
  }
  return (
    <div className="attached-references">
      {references.map((reference, index) => (
        <div className="attached-reference" key={`${reference.link}-${index}`}>
          <ImageOrPlaceholder result={reference} className="attached-reference-thumb" />
          <span>{reference.source || "Unknown source"}</span>
          <button type="button" onClick={() => onRemove(index)}>Remove</button>
        </div>
      ))}
    </div>
  );
}

function Designs() {
  const [request, setRequest] = useState("");
  const [results, setResults] = useState([]);
  const [searchesLeft, setSearchesLeft] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedResult, setSelectedResult] = useState(null);
  const [orders, setOrders] = useState([]);
  const [draft, setDraft] = useState(null);
  const [isLoadingOrders, setIsLoadingOrders] = useState(true);
  const [selectedTarget, setSelectedTarget] = useState("");
  const [attachMessage, setAttachMessage] = useState("");
  const [attachError, setAttachError] = useState("");

  useEffect(() => {
    try {
      setOrders(getOrders());
      setDraft(getOrderDraft());
    } catch (error) {
      setAttachError(error.message);
    } finally {
      setIsLoadingOrders(false);
    }
  }, []);

  async function handleSearch(event) {
    event.preventDefault();
    if (!request.trim() || isSearching) {
      return;
    }
    setIsSearching(true);
    setSearchError("");
    setResults([]);
    setHasSearched(false);
    setSearchesLeft(null);
    try {
      const result = await searchDesigns(request.trim());
      setResults(result.results);
      setSearchesLeft(result.searchesLeft);
      setHasSearched(true);
    } catch (error) {
      setSearchError(getSearchErrorMessage(error));
      setHasSearched(true);
    } finally {
      setIsSearching(false);
    }
  }

  function selectedTargetReferences() {
    if (selectedTarget === "draft") {
      return draft?.order?.references ?? [];
    }
    return orders.find((order) => order.id === selectedTarget)?.references ?? [];
  }

  function addReference() {
    if (!selectedResult || !selectedTarget) {
      setAttachError("Choose an order first.");
      return;
    }
    const reference = {
      title: selectedResult.title,
      thumbnail: selectedResult.thumbnail,
      source: selectedResult.source,
      link: selectedResult.link,
    };
    const references = selectedTargetReferences();
    if (references.length >= 3) {
      setAttachError("An order can have up to 3 design references.");
      return;
    }
    if (references.some((saved) => saved.link === reference.link)) {
      setAttachError("This design is already attached to the order.");
      return;
    }
    try {
      if (selectedTarget === "draft") {
        const updatedDraft = {
          ...draft,
          order: {
            ...draft.order,
            references: [...references, reference],
          },
        };
        saveOrderDraft(updatedDraft);
        setDraft(updatedDraft);
      } else {
        const updated = updateOrder(selectedTarget, { references: [...references, reference] });
        setOrders((current) => current.map((order) => order.id === updated.id ? updated : order));
      }
      setAttachError("");
      setAttachMessage("Reference attached to the order.");
    } catch (error) {
      setAttachError(error.message);
    }
  }

  function removeReference(index) {
    if (!selectedTarget) {
      return;
    }
    const updatedReferences = selectedTargetReferences().filter((_, referenceIndex) => referenceIndex !== index);
    try {
      if (selectedTarget === "draft") {
        const updatedDraft = {
          ...draft,
          order: { ...draft.order, references: updatedReferences },
        };
        saveOrderDraft(updatedDraft);
        setDraft(updatedDraft);
      } else {
        const updated = updateOrder(selectedTarget, { references: updatedReferences });
        setOrders((current) => current.map((order) => order.id === updated.id ? updated : order));
      }
      setAttachError("");
    } catch (error) {
      setAttachError(error.message);
    }
  }

  function openResult(result) {
    setSelectedResult(result);
    setSelectedTarget("");
    setAttachMessage("");
    setAttachError("");
  }

  const references = selectedTarget ? selectedTargetReferences() : [];
  const noSearchResults = hasSearched && !searchError && results.length === 0;

  return (
    <section className="designs-screen" aria-labelledby="designs-title">
      <header className="designs-heading">
        <p className="eyebrow">YOUR WORKROOM</p>
        <h2 id="designs-title">Designs</h2>
      </header>
      <form className="design-search-form" onSubmit={handleSearch}>
        <label className="visually-hidden" htmlFor="design-search">
          Describe a design to search
        </label>
        <textarea
          id="design-search"
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          placeholder="Describe the design, for example: bridal blouse, boat neck, deep back"
          rows={3}
        />
        <button className="primary-button" type="submit" disabled={isSearching || !request.trim()}>
          {isSearching ? "Searching..." : "Search"}
        </button>
      </form>

      {isSearching && (
        <div className="design-loading" role="status">
          <span className="loading-spinner" aria-hidden="true" />
          Finding design pictures...
        </div>
      )}
      {isLoadingOrders && !hasSearched && (
        <div className="screen-loading" role="status">
          <span className="loading-spinner" aria-hidden="true" />
          Loading your saved orders...
        </div>
      )}
      {searchError && <p className="design-search-message design-search-error" role="alert">{searchError}</p>}
      {noSearchResults && (
        <p className="design-search-message">No designs found, try different words</p>
      )}
      {!isSearching && !hasSearched && !isLoadingOrders && (
        <div className="designs-empty">
          <span className="empty-icon" aria-hidden="true">✧</span>
          <p>Describe an outfit idea to find design pictures to use as references.</p>
        </div>
      )}
      {results.length > 0 && (
        <>
          <div className="design-results" aria-label="Design search results">
            {results.slice(0, 8).map((result, index) => (
              <button
                className="design-result-card"
                type="button"
                key={`${result.link}-${index}`}
                onClick={() => openResult(result)}
              >
                <ImageOrPlaceholder result={result} className="design-result-image" />
                <span className="design-result-title">{result.title}</span>
                <span className="design-result-source">{result.source}</span>
              </button>
            ))}
          </div>
          <p className="design-rights-note">
            Images belong to their original websites. Linked, not copied.
            {searchesLeft !== null && <span> · {searchesLeft} searches left</span>}
          </p>
        </>
      )}

      {selectedResult && (
        <div className="sheet-backdrop" onClick={() => setSelectedResult(null)}>
          <section
            className="design-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="design-sheet-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sheet-handle" aria-hidden="true" />
            <button
              className="sheet-close design-sheet-close"
              type="button"
              onClick={() => setSelectedResult(null)}
              aria-label="Close design details"
            >
              ×
            </button>
            <ImageOrPlaceholder
              key={selectedResult.link}
              result={selectedResult}
              className="design-sheet-image"
            />
            <h2 id="design-sheet-title">{selectedResult.title}</h2>
            <p className="design-sheet-source">{selectedResult.source}</p>
            <a
              className="source-page-link"
              href={selectedResult.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open source page
            </a>

            <div className="reference-picker">
              <label htmlFor="reference-order">Use as reference</label>
              <select
                id="reference-order"
                value={selectedTarget}
                onChange={(event) => {
                  setSelectedTarget(event.target.value);
                  setAttachMessage("");
                  setAttachError("");
                }}
              >
                <option value="">Choose an order</option>
                {draft && (
                  <option value="draft">
                    Attach to the order I&apos;m creating
                    {draft.order?.customer ? ` — ${draft.order.customer}` : ""}
                  </option>
                )}
                {orders.map((order) => (
                  <option value={order.id} key={order.id}>
                    {order.customer || "Customer not set"} — {order.garment || "New order"}
                  </option>
                ))}
              </select>
              <button
                className="primary-button attach-reference-button"
                type="button"
                disabled={!selectedTarget || references.length >= 3}
                onClick={addReference}
              >
                Use as reference
              </button>
              {selectedTarget && references.length >= 3 && (
                <p className="reference-error">An order can have up to 3 design references.</p>
              )}
              {selectedTarget && (
                <ReferencesList references={references} onRemove={removeReference} />
              )}
              {attachMessage && <p className="reference-success" role="status">{attachMessage}</p>}
              {attachError && <p className="reference-error" role="alert">{attachError}</p>}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export default Designs;
