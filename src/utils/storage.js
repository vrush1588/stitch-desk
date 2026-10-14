const STORAGE_KEY = "naturequest.entries";

export function getEntries() {
  try {
    const storedEntries = localStorage.getItem(STORAGE_KEY);
    if (storedEntries === null) {
      return [];
    }

    const entries = JSON.parse(storedEntries);
    if (!Array.isArray(entries)) {
      throw new Error("Saved nature log data has an invalid format.");
    }

    return entries.sort(
      (a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime(),
    );
  } catch (error) {
    throw new Error(`Unable to load your nature log: ${error.message}`);
  }
}

export function saveEntry(entry) {
  try {
    const savedEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      dateTime: new Date().toISOString(),
    };
    const entries = getEntries();
    localStorage.setItem(STORAGE_KEY, JSON.stringify([savedEntry, ...entries]));
    return savedEntry;
  } catch (error) {
    throw new Error(`Unable to save this nature log entry: ${error.message}`);
  }
}

export function deleteEntry(id) {
  try {
    const entries = getEntries();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(entries.filter((entry) => entry.id !== id)),
    );
  } catch (error) {
    throw new Error(`Unable to delete this nature log entry: ${error.message}`);
  }
}
