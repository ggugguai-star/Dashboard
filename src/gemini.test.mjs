/**
 * gemini 골든셋 — URL·에러·메시지·SSE 파서
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGenerateUrl,
  normalizeGeminiError,
  buildContentsFromMessages,
  extractTextFromSseChunk,
  readFileAsBase64Part,
  DEFAULT_GEMINI_MODEL,
} from './gemini.js';

describe('buildGenerateUrl', () => {
  it('builds stream URL with key', () => {
    const url = buildGenerateUrl('gemini-2.5-flash-lite', true, 'test-key');
    assert.ok(url.includes('streamGenerateContent'));
    assert.ok(url.includes('alt=sse'));
    assert.ok(url.includes('key=test-key'));
  });

  it('builds non-stream URL', () => {
    const url = buildGenerateUrl(DEFAULT_GEMINI_MODEL, false, 'k');
    assert.ok(url.includes('generateContent'));
    assert.ok(!url.includes('alt=sse'));
  });
});

describe('normalizeGeminiError', () => {
  it('maps 401 to invalid key', () => {
    const err = normalizeGeminiError(401, '{}');
    assert.match(err.error, /유효하지/);
    assert.equal(err.code, 401);
  });

  it('maps 429 to quota message', () => {
    const err = normalizeGeminiError(429, '');
    assert.match(err.error, /한도/);
  });
});

describe('buildContentsFromMessages', () => {
  it('converts user and model roles', () => {
    const contents = buildContentsFromMessages([
      { role: 'user', text: '안녕' },
      { role: 'model', text: '반가워요' },
    ]);
    assert.equal(contents.length, 2);
    assert.equal(contents[0].role, 'user');
    assert.equal(contents[0].parts[0].text, '안녕');
    assert.equal(contents[1].role, 'model');
  });

  it('merges extra parts into last user turn', () => {
    const part = readFileAsBase64Part('image/png', 'abc');
    const contents = buildContentsFromMessages([{ role: 'user', text: '보기' }], [part]);
    assert.equal(contents[0].parts.length, 2);
    assert.ok(contents[0].parts[1].inlineData);
  });
});

describe('extractTextFromSseChunk', () => {
  it('parses SSE data line', () => {
    const chunk = 'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}\n\n';
    assert.equal(extractTextFromSseChunk(chunk), 'Hi');
  });

  it('accumulates multiple parts', () => {
    const chunk = [
      'data: {"candidates":[{"content":{"parts":[{"text":"A"}]}}]}',
      'data: {"candidates":[{"content":{"parts":[{"text":"B"}]}}]}',
    ].join('\n');
    assert.equal(extractTextFromSseChunk(chunk), 'AB');
  });
});
