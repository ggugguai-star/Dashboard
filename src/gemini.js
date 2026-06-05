/**
 * gemini.js — Gemini API (순수 fetch·SSE·첨부 전처리)
 */

export const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash-lite', label: 'Flash-Lite (기본·1,000 RPD)' },
  { id: 'gemini-2.5-flash', label: 'Flash (250 RPD)' },
  { id: 'gemini-2.5-pro', label: 'Pro (100 RPD·유료화 예정)' },
];

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';
export const LARGE_FILE_BYTES = 20 * 1024 * 1024;

/** @param {string} model @param {boolean} [stream] @param {string} apiKey */
export function buildGenerateUrl(model, stream, apiKey) {
  const m = model || DEFAULT_GEMINI_MODEL;
  const action = stream ? 'streamGenerateContent' : 'generateContent';
  const params = new URLSearchParams({ key: apiKey });
  if (stream) params.set('alt', 'sse');
  return `https://generativelanguage.googleapis.com/v1beta/models/${m}:${action}?${params}`;
}

/** @param {number} status @param {string} [bodyText] */
export function normalizeGeminiError(status, bodyText = '') {
  let detail = '';
  try {
    const parsed = JSON.parse(bodyText);
    detail = parsed?.error?.message || parsed?.error?.status || '';
  } catch {
    detail = bodyText?.slice(0, 200) || '';
  }
  if (status === 401 || status === 403) {
    return { error: 'API 키가 유효하지 않습니다', code: status };
  }
  if (status === 429) {
    return {
      error: '일일/분당 한도를 초과했습니다. Flash-Lite 모델을 사용하거나 잠시 후 다시 시도하세요',
      code: status,
    };
  }
  if (status >= 500) {
    return { error: `Gemini 서버 오류 (${status})`, code: status };
  }
  return { error: detail || `요청 실패 (${status})`, code: status };
}

/**
 * @param {Array<{role:string,text?:string,parts?:object[]}>} messages
 * @param {object[]} [extraParts] — 마지막 user 턴에 병합
 */
export function buildContentsFromMessages(messages, extraParts = []) {
  const contents = [];
  const list = Array.isArray(messages) ? messages : [];
  for (let i = 0; i < list.length; i += 1) {
    const msg = list[i];
    const role = msg.role === 'model' ? 'model' : 'user';
    const parts = [];
    if (msg.text) parts.push({ text: msg.text });
    if (Array.isArray(msg.parts)) parts.push(...msg.parts);
    const isLastUser = role === 'user' && i === list.length - 1;
    if (isLastUser && extraParts.length) parts.push(...extraParts);
    if (parts.length) contents.push({ role, parts });
  }
  if (extraParts.length && (list.length === 0 || list[list.length - 1]?.role === 'model')) {
    contents.push({ role: 'user', parts: [...extraParts, { text: '' }] });
  }
  return contents;
}

/** @param {string} mime @param {string} base64 */
export function readFileAsBase64Part(mime, base64) {
  return { inlineData: { mimeType: mime, data: base64 } };
}

/** @param {string} uri @param {string} mime */
export function readFileUriPart(uri, mime) {
  return { fileData: { mimeType: mime, fileUri: uri } };
}

/**
 * SSE 청크에서 텍스트 델타 추출 (node 테스트용)
 * @param {string} chunk
 */
export function extractTextFromSseChunk(chunk) {
  let out = '';
  const lines = String(chunk || '').split('\n');
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const json = JSON.parse(payload);
      const parts = json?.candidates?.[0]?.content?.parts || [];
      for (const p of parts) {
        if (p.text) out += p.text;
      }
    } catch {
      // ignore partial JSON
    }
  }
  return out;
}

/**
 * @param {{ apiKey:string, model?:string, messages:object[], attachmentParts?:object[], onChunk?:(t:string)=>void, signal?:AbortSignal }} opts
 */
export async function streamGenerateContent({
  apiKey, model, messages, attachmentParts = [], onChunk, signal,
}) {
  if (!apiKey) return { error: 'API 키가 설정되지 않았습니다' };
  const contents = buildContentsFromMessages(messages, attachmentParts);
  if (!contents.length) return { error: '메시지가 비어 있습니다' };
  const url = buildGenerateUrl(model || DEFAULT_GEMINI_MODEL, true, apiKey);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents }),
      signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') return { aborted: true };
    return { error: e?.message || '네트워크 오류' };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return normalizeGeminiError(res.status, text);
  }
  const reader = res.body?.getReader();
  if (!reader) return { error: '스트림을 읽을 수 없습니다' };
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const block of parts) {
      const delta = extractTextFromSseChunk(block);
      if (delta) {
        full += delta;
        if (typeof onChunk === 'function') onChunk(full);
      }
    }
  }
  if (buffer) {
    const delta = extractTextFromSseChunk(buffer);
    if (delta) {
      full += delta;
      if (typeof onChunk === 'function') onChunk(full);
    }
  }
  return { text: full };
}

/**
 * @param {{ apiKey:string, model?:string, firstUserText:string }} opts
 */
export async function generateTitle({ apiKey, model, firstUserText }) {
  if (!apiKey || !firstUserText) return { title: '새 대화' };
  const url = buildGenerateUrl(model || DEFAULT_GEMINI_MODEL, false, apiKey);
  const prompt = `다음 대화의 짧은 한국어 제목(15자 이내, 따옴표 없음)만 출력:\n${firstUserText.slice(0, 200)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 30, temperature: 0.2 },
      }),
    });
    if (!res.ok) return { title: '새 대화' };
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const title = raw.replace(/["'\n]/g, '').trim().slice(0, 30) || '새 대화';
    return { title };
  } catch {
    return { title: '새 대화' };
  }
}

/** @param {ArrayBuffer} arrayBuffer */
export async function extractDocxText(arrayBuffer) {
  try {
    const mod = await import('../node_modules/mammoth/mammoth.browser.min.js');
    const mammoth = mod.default || mod;
    const result = await mammoth.extractRawText({ arrayBuffer });
    return { text: result?.value || '' };
  } catch (e) {
    return { error: e?.message || 'DOCX 추출 실패' };
  }
}

/** @param {ArrayBuffer} arrayBuffer */
export async function extractXlsxText(arrayBuffer) {
  try {
    const XLSX = await import('../node_modules/xlsx/xlsx.mjs');
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const name = wb.SheetNames?.[0];
    if (!name) return { text: '' };
    const sheet = wb.Sheets[name];
    return { text: XLSX.utils.sheet_to_csv(sheet) };
  } catch (e) {
    return { error: e?.message || 'XLSX 추출 실패' };
  }
}

/**
 * @param {{ apiKey:string, bytes:Uint8Array|ArrayBuffer, mime:string, displayName:string }} opts
 */
export async function uploadLargeFile({ apiKey, bytes, mime, displayName }) {
  if (!apiKey) return { error: 'API 키가 설정되지 않았습니다' };
  const url = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`;
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': mime,
        'X-Goog-Upload-Protocol': 'raw',
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Header-Content-Length': String(body.byteLength),
        'X-Goog-Upload-Header-Content-Type': mime,
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return normalizeGeminiError(res.status, text);
    }
    const data = await res.json();
    const file = data?.file;
    if (!file?.uri) return { error: '파일 업로드 응답이 올바르지 않습니다' };
    return { uri: file.uri, mimeType: file.mimeType || mime, name: displayName };
  } catch (e) {
    return { error: e?.message || '파일 업로드 실패' };
  }
}

/** @param {ArrayBuffer} buf */
export function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
