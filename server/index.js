import "dotenv/config";
import express from "express";

const app = express();
const port = Number(process.env.PORT) || 3001;
const cache = new Map();
const inFlight = new Map();
let realSearchCount = 0;
const searchLimit = 20;

function setSearchesLeft(response) {
  response.set("X-Searches-Left", String(Math.max(0, searchLimit - realSearchCount)));
}

app.get("/api/design-search", async (request, response) => {
  const query = request.query.q;
  if (typeof query !== "string" || query.trim().length === 0 || query.trim().length >= 120) {
    response.status(400).json({ error: "Query must be a non-empty string under 120 characters." });
    return;
  }

  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (cache.has(normalizedQuery)) {
    setSearchesLeft(response);
    const cached = cache.get(normalizedQuery);
    if (cached.error) {
      response.status(cached.status).json({ error: cached.error });
    } else {
      response.json(cached.results);
    }
    return;
  }
  if (inFlight.has(normalizedQuery)) {
    setSearchesLeft(response);
    try {
      response.json(await inFlight.get(normalizedQuery));
    } catch (error) {
      cache.set(normalizedQuery, { error: error.message, status: error.status || 502 });
      response.status(error.status || 502).json({ error: error.message });
    }
    return;
  }

  setSearchesLeft(response);
  const apiKey = process.env.SERPAPI_KEY?.trim();
  if (!apiKey) {
    response.status(500).json({ error: "SerpApi is not configured. Set SERPAPI_KEY in the .env file." });
    return;
  }
  if (realSearchCount >= searchLimit) {
    setSearchesLeft(response);
    response.status(429).json({ error: "Search limit reached" });
    return;
  }

  realSearchCount += 1;
  const search = (async () => {
    const searchUrl = new URL("https://serpapi.com/search.json");
    searchUrl.search = new URLSearchParams({
      engine: "google_images",
      q: query.trim(),
      hl: "en",
      gl: "in",
      api_key: apiKey,
    }).toString();

    let serpResponse;
    try {
      serpResponse = await fetch(searchUrl);
    } catch {
      throw Object.assign(new Error("Unable to reach SerpApi. Please try again."), { status: 502 });
    }

    let data;
    try {
      data = await serpResponse.json();
    } catch {
      throw Object.assign(new Error("SerpApi returned an unreadable response."), { status: 502 });
    }
    if (!serpResponse.ok || data.error) {
      throw Object.assign(new Error("SerpApi image search failed. Please check the API key and try again."), {
        status: 502,
      });
    }

    const results = (Array.isArray(data.images_results) ? data.images_results : [])
      .slice(0, 8)
      .map((item) => ({
        title: typeof item.title === "string" ? item.title.trim() : "",
        thumbnail: typeof item.thumbnail === "string" ? item.thumbnail.trim() : "",
        source: typeof item.source === "string" ? item.source.trim() : "",
        link: typeof item.link === "string" ? item.link.trim() : "",
      }));
    cache.set(normalizedQuery, { results });
    return results;
  })();

  inFlight.set(normalizedQuery, search);
  try {
    setSearchesLeft(response);
    response.json(await search);
  } catch (error) {
    setSearchesLeft(response);
    cache.set(normalizedQuery, { error: error.message, status: error.status || 502 });
    response.status(error.status || 502).json({ error: error.message });
  } finally {
    inFlight.delete(normalizedQuery);
  }
});

app.listen(port, () => {
  console.log(`Design search API listening on port ${port}`);
});
