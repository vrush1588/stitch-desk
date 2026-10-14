import { generate } from "./gemma.js";
import { getCustomerProfiles } from "../utils/customers.js";
import { getOrderDraft, getOrders } from "../utils/orders.js";

function stripCodeFences(response) {
  return response
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

function savedCustomerNames() {
  const names = new Set();
  for (const profile of getCustomerProfiles()) {
    if (typeof profile.name === "string" && profile.name.trim()) {
      names.add(profile.name.trim());
    }
  }
  for (const order of getOrders()) {
    if (typeof order.customer === "string" && order.customer.trim()) {
      names.add(order.customer.trim());
    }
  }
  const draft = getOrderDraft();
  if (typeof draft?.order?.customer === "string" && draft.order.customer.trim()) {
    names.add(draft.order.customer.trim());
  }
  return [...names];
}

const privateMeasurementTerms =
  /\b(chest|bust|waist|hip|length|shoulder|sleeve|neck|inseam|outseam|measurement|measurements)\b/i;

function containsCustomerName(query, names) {
  const queryWords = new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  return names.some((name) =>
    (name.toLocaleLowerCase().match(/[\p{L}]+/gu) ?? []).some((word) => queryWords.has(word)),
  );
}

function containsPrivateSearchData(query, names) {
  return (
    /\d/.test(query) ||
    privateMeasurementTerms.test(query) ||
    /\b(phone|mobile|email|price|total|advance|cost|rupees?)\b/i.test(query) ||
    containsCustomerName(query, names)
  );
}

function fallbackQuery(request, names) {
  const safeSegments = request
    .split(/[,;\n|]+/)
    .map((segment) => segment.trim())
    .filter(
      (segment) =>
        segment &&
        !/\d/.test(segment) &&
        !privateMeasurementTerms.test(segment) &&
        !/\b(phone|mobile|email|price|total|advance|cost|rupees?)\b/i.test(segment) &&
        !containsCustomerName(segment, names),
    );
  const normalized = safeSegments.join(" ");
  if (!normalized) {
    return "design";
  }
  const suffix = " design";
  return `${normalized.slice(0, 119 - suffix.length).trimEnd()}${suffix}`;
}

export async function buildDesignQueries(request) {
  if (typeof request !== "string" || !request.trim()) {
    return [];
  }

  let fallback = "design";
  try {
    const names = savedCustomerNames();
    fallback = fallbackQuery(request, names);
    const response = await generate([
      "Return JSON only in exactly this shape: {\"queries\": [\"...\", \"...\"]}.",
      "Create exactly 2 short English search queries for current outfit design pictures.",
      "Each query must have fewer than 8 words and be under 80 characters.",
      "Use only words from the design request plus common garment or style terms.",
      "Never include customer names, phone numbers, prices, or measurements.",
      "Do not add brand names.",
      `Design request: ${request.trim()}`,
    ].join(" "));
    const parsed = JSON.parse(stripCodeFences(response));
    if (
      !parsed ||
      !Array.isArray(parsed.queries) ||
      parsed.queries.length < 1 ||
      parsed.queries.length > 2 ||
      !parsed.queries.every(
        (query) =>
          typeof query === "string" &&
          query.trim().length > 0 &&
          query.trim().length < 80 &&
          query.trim().split(/\s+/).length < 8,
      )
    ) {
      return [fallback];
    }

    const safeQueries = parsed.queries
      .map((query) => query.trim())
      .filter((query) => !containsPrivateSearchData(query, names));
    return safeQueries.length > 0 ? safeQueries : [fallback];
  } catch {
    return [fallback];
  }
}

export async function searchDesigns(request) {
  const queries = await buildDesignQueries(request);
  if (queries.length === 0) {
    return { results: [], searchesLeft: null };
  }

  const responses = await Promise.all(
    queries.map(async (query) => {
      const url = new URL("/api/design-search", window.location.origin);
      url.searchParams.set("q", query);
      const response = await fetch(url);
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error("Design search returned an unreadable response.");
      }
      if (!response.ok) {
        throw new Error(payload.error || "Design search failed.");
      }

      const remainingHeader = response.headers.get("X-Searches-Left");
      const remaining = remainingHeader === null ? null : Number(remainingHeader);
      return {
        results: Array.isArray(payload) ? payload : [],
        searchesLeft: remaining !== null && Number.isInteger(remaining) ? remaining : null,
      };
    }),
  );

  const seenLinks = new Set();
  const results = [];
  for (const { results: queryResults } of responses) {
    for (const result of queryResults) {
      const link = typeof result.link === "string" ? result.link : "";
      if (link && seenLinks.has(link)) {
        continue;
      }
      if (link) {
        seenLinks.add(link);
      }
      results.push(result);
      if (results.length === 8) {
        break;
      }
    }
    if (results.length === 8) {
      break;
    }
  }

  const remainingValues = responses
    .map(({ searchesLeft }) => searchesLeft)
    .filter((value) => value !== null);
  return {
    results,
    searchesLeft: remainingValues.length ? Math.min(...remainingValues) : null,
  };
}
