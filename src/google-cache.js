/**
 * google-cache.js — Google API 공유 페치 캐시 (TTL + in-flight dedupe)
 */

export const DEFAULT_EVENTS_TTL_MS = 60_000;
export const DEFAULT_LIST_TTL_MS = 300_000;

/** @param {string} calendarId @param {string} [timeMin] @param {string} [timeMax] */
export function buildCalendarEventsKey(calendarId, timeMin, timeMax) {
  const id = calendarId ?? 'primary';
  return `cal:events:${id}:${timeMin ?? ''}:${timeMax ?? ''}`;
}

export function buildCalendarListKey() {
  return 'cal:list';
}

/** @param {string} mimeType */
export function buildDriveMimeListKey(mimeType) {
  return `drive:mime:${mimeType}`;
}

/**
 * @param {{ defaultTtlMs?: number }} [options]
 */
export function createGoogleCache(options = {}) {
  return {
    defaultTtlMs: options.defaultTtlMs ?? DEFAULT_EVENTS_TTL_MS,
    entries: new Map(),
    inflight: new Map(),
  };
}

/**
 * @param {ReturnType<typeof createGoogleCache>} cache
 * @param {string} key
 * @param {number} [ttlMs]
 * @param {() => Promise<object>} fetcher
 */
export async function fetchCached(cache, key, ttlMs, fetcher) {
  const ttl = ttlMs ?? cache.defaultTtlMs;
  const now = Date.now();
  const hit = cache.entries.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.value;
  }

  if (cache.inflight.has(key)) {
    return cache.inflight.get(key);
  }

  const promise = (async () => {
    try {
      const value = await fetcher();
      if (value && !value.error) {
        cache.entries.set(key, { value, expiresAt: Date.now() + ttl });
      }
      return value;
    } finally {
      cache.inflight.delete(key);
    }
  })();

  cache.inflight.set(key, promise);
  return promise;
}

/**
 * @param {ReturnType<typeof createGoogleCache>} cache
 * @param {string} keyPrefix
 */
export function invalidateCache(cache, keyPrefix) {
  for (const key of [...cache.entries.keys()]) {
    if (key.startsWith(keyPrefix)) {
      cache.entries.delete(key);
    }
  }
  for (const key of [...cache.inflight.keys()]) {
    if (key.startsWith(keyPrefix)) {
      cache.inflight.delete(key);
    }
  }
}
