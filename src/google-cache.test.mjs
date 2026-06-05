/**
 * google-cache 골든셋 — TTL·in-flight dedupe
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGoogleCache,
  fetchCached,
  invalidateCache,
  buildCalendarEventsKey,
} from './google-cache.js';

describe('buildCalendarEventsKey', () => {
  it('includes calendarId and range', () => {
    assert.equal(
      buildCalendarEventsKey('primary', '2026-01-01', '2026-02-01'),
      'cal:events:primary:2026-01-01:2026-02-01',
    );
  });
});

describe('fetchCached', () => {
  it('same key within TTL calls fetcher once', async () => {
    const cache = createGoogleCache({ defaultTtlMs: 60_000 });
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return { events: [] };
    };
    await fetchCached(cache, 'k1', 60_000, fetcher);
    await fetchCached(cache, 'k1', 60_000, fetcher);
    assert.equal(calls, 1);
  });

  it('does not cache errors', async () => {
    const cache = createGoogleCache();
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return { error: 'fail' };
    };
    await fetchCached(cache, 'k2', 60_000, fetcher);
    await fetchCached(cache, 'k2', 60_000, fetcher);
    assert.equal(calls, 2);
  });

  it('in-flight dedupe shares one fetcher', async () => {
    const cache = createGoogleCache();
    let calls = 0;
    const fetcher = () => new Promise((resolve) => {
      calls += 1;
      setTimeout(() => resolve({ events: [] }), 25);
    });
    const [a, b] = await Promise.all([
      fetchCached(cache, 'k3', 60_000, fetcher),
      fetchCached(cache, 'k3', 60_000, fetcher),
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(a, b);
  });

  it('invalidateCache clears matching entries', async () => {
    const cache = createGoogleCache();
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return { events: [] };
    };
    const key = buildCalendarEventsKey('primary', 'a', 'b');
    await fetchCached(cache, key, 60_000, fetcher);
    invalidateCache(cache, 'cal:events:primary');
    await fetchCached(cache, key, 60_000, fetcher);
    assert.equal(calls, 2);
  });
});
