type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const entries = new Map<string, CacheEntry>();
const MAX_ENTRIES = 100;

// This is deliberately short-lived and process-local. It is only intended to
// collapse simultaneous dashboard reads from several browser tabs; it is not a
// source of truth and never replaces authorization checks.
export const getResponseCache = <T>(key: string): T | null => {
  const entry = entries.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    entries.delete(key);
    return null;
  }

  return entry.value as T;
};

export const setResponseCache = (key: string, value: unknown, ttlMs = 5_000) => {
  if (entries.size >= MAX_ENTRIES && !entries.has(key)) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey) entries.delete(oldestKey);
  }

  entries.set(key, { value, expiresAt: Date.now() + ttlMs });
};

