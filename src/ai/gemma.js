const MODEL_NAME = "gemma3:4b";

let isConnected = false;
let connectionPromise;
let generationQueue = Promise.resolve();

function getOllamaApiUrl() {
  const hostname = window.location.hostname;
  return `http://${hostname}:11434`;
}

async function fetchOllama(path, options) {
  let response;
  try {
    response = await fetch(`${getOllamaApiUrl()}${path}`, options);
  } catch {
    throw new Error(
      `Could not reach Ollama at ${getOllamaApiUrl()}. On mobile, open Stitch Desk using your computer's LAN IP and allow that app origin in Ollama's OLLAMA_ORIGINS.`,
    );
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Ollama returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  return response;
}

async function connectToOllama() {
  const response = await fetchOllama("/api/tags");
  const { models } = await response.json();
  const modelIsInstalled = models?.some(
    (model) => model.name === MODEL_NAME || model.name.startsWith(`${MODEL_NAME}:`),
  );

  if (!modelIsInstalled) {
    throw new Error(`The ${MODEL_NAME} model is not installed in Ollama.`);
  }

  isConnected = true;
}

export function loadModel(onProgress) {
  if (isConnected) {
    onProgress?.(1);
    return Promise.resolve();
  }

  if (!connectionPromise) {
    connectionPromise = connectToOllama()
      .then(() => {
        isConnected = true;
        onProgress?.(1);
      })
      .catch((error) => {
        connectionPromise = undefined;
        throw error;
      });
  }

  return connectionPromise;
}

export async function generate(prompt) {
  if (!isConnected) {
    throw new Error("Connect to the local Ollama model before generating advice.");
  }

  const generation = generationQueue.then(async () => {
    const response = await fetchOllama("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL_NAME,
        prompt,
        format: "json",
        stream: false,
      }),
    });
    const result = await response.json();

    if (typeof result.response !== "string" || !result.response.trim()) {
      throw new Error("Ollama returned an empty response.");
    }

    return result.response;
  });

  generationQueue = generation.catch(() => undefined);
  return generation;
}

export async function analyzeImage(prompt, imageBase64) {
  if (!isConnected) {
    await loadModel();
  }

  const analysis = generationQueue.then(async () => {
    const response = await fetchOllama("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [{ role: "user", content: prompt, images: [imageBase64] }],
        stream: false,
        keep_alive: "10m",
        options: {
          temperature: 0.2,
          num_predict: 160,
        },
      }),
    });
    const result = await response.json();

    if (typeof result.message?.content !== "string" || !result.message.content.trim()) {
      throw new Error("Ollama returned an empty photo analysis.");
    }

    return result.message.content;
  });

  generationQueue = analysis.catch(() => undefined);
  return analysis;
}
