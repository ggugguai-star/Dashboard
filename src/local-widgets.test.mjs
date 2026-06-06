/**
 * local-widgets 골든셋
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeDday, formatPomoTime } from './local-widgets.js';

describe('computeDday', () => {
  it('returns 0 on target day', () => {
    assert.equal(computeDday('2026-06-05', new Date(2026, 5, 5)), 0);
  });

  it('returns positive days before target', () => {
    assert.equal(computeDday('2026-06-10', new Date(2026, 5, 5)), 5);
  });

  it('returns negative after target', () => {
    assert.equal(computeDday('2026-06-01', new Date(2026, 5, 5)), -4);
  });

  it('returns null for invalid input', () => {
    assert.equal(computeDday(''), null);
    assert.equal(computeDday('bad'), null);
  });
});

describe('formatPomoTime', () => {
  it('formats mm:ss', () => {
    assert.equal(formatPomoTime(125), '02:05');
    assert.equal(formatPomoTime(0), '00:00');
  });
});
