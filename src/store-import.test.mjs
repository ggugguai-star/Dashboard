/**
 * store-import 골든셋 — export/import·검증
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION,
  createEmptyState,
  seedDefaultWidgets,
  exportState,
  importState,
  validateImportState,
  normalizeImportedState,
} from './store.js';

describe('exportState', () => {
  it('includes secrets when includeKeys true', () => {
    const base = seedDefaultWidgets(createEmptyState());
    base.secrets = { geminiApiKey: 'test-key' };
    const json = exportState(base, { includeKeys: true });
    const parsed = JSON.parse(json);
    assert.equal(parsed.secrets.geminiApiKey, 'test-key');
  });

  it('strips secrets when includeKeys false', () => {
    const base = seedDefaultWidgets(createEmptyState());
    base.secrets = { geminiApiKey: 'test-key' };
    const json = exportState(base, { includeKeys: false });
    const parsed = JSON.parse(json);
    assert.deepEqual(parsed.secrets, {});
  });
});

describe('importState', () => {
  it('imports valid state with geminiChats fallback', () => {
    const base = seedDefaultWidgets(createEmptyState());
    base.secrets = { geminiApiKey: 'k' };
    base.geminiChats = [{ id: 'chat-1', widgetId: 'ai-1', title: 't', messages: [] }];
    const text = exportState(base);
    const imported = importState(text);
    assert.equal(imported.secrets.geminiApiKey, 'k');
    assert.equal(imported.geminiChats.length, 1);
  });

  it('rejects invalid JSON', () => {
    assert.throws(() => importState('{bad'), /Invalid state JSON/);
  });

  it('rejects future schema', () => {
    const bad = JSON.stringify({ schema: SCHEMA_VERSION + 1, widgets: [] });
    assert.throws(() => importState(bad), /Unsupported schema version/);
  });

  it('rejects missing widgets array', () => {
    assert.throws(() => importState('{"schema":3}'), /Invalid state JSON/);
  });
});

describe('validateImportState', () => {
  it('accepts minimal valid object', () => {
    const v = validateImportState({ schema: 3, widgets: [] });
    assert.equal(v.ok, true);
  });
});

describe('normalizeImportedState', () => {
  it('fills geminiChats when absent', () => {
    const n = normalizeImportedState({ schema: 3, widgets: [] });
    assert.deepEqual(n.geminiChats, []);
    assert.deepEqual(n.secrets, {});
  });
});
