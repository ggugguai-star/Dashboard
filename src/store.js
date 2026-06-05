/**
 * store.js — 통합 JSON 영속화 (schema 3)
 *
 * localStorage 키 매핑 (grep 전수조사, OAuth 토큰 제외):
 *   appCats          → widgets[] type:category
 *   appTodos         → widgets[] type:todo items + source.taskListId
 *   appScale         → settings.scale
 *   setupDone        → settings.setupDone
 *   driveWeeklyId    → drive 위젯 source.folderId
 *   driveMemoId      → settings.driveMemoId
 *   gtasksListId     → todo 위젯 source.taskListId
 *   gtasksLastSync   → settings.gtasksLastSync
 *   calAlarms        → settings.calAlarms
 *   weeklyPlanTitle  → drive 위젯 title
 */

import { compactVertical, GRID_COLS } from './layout-engine.js';

export const SCHEMA_VERSION = 3;
export const STATE_FILE = 'dashboard-state.json';
export const STATE_TMP = 'dashboard-state.json.tmp';
export const BACKUP_COUNT = 5;

const WIDGET_DEFAULTS = {
  calendar: { w: 4, h: 4, minW: 4, minH: 4 },
  drive: { w: 3, h: 3, minW: 3, minH: 3 },
  todo: { w: 3, h: 4, minW: 3, minH: 4 },
  category: { w: 2, h: 3, minW: 2, minH: 3 },
  clock: { w: 2, h: 2, minW: 2, minH: 2 },
  sticky: { w: 2, h: 2, minW: 2, minH: 2 },
  pomodoro: { w: 2, h: 2, minW: 2, minH: 2 },
  dday: { w: 2, h: 2, minW: 2, minH: 2 },
  weather: { w: 3, h: 2, minW: 2, minH: 2 },
  gemini: { w: 4, h: 4, minW: 3, minH: 3 },
};

const TYPE_ORDER = {
  calendar: 0, drive: 1, todo: 2, category: 3,
  clock: 4, sticky: 5, pomodoro: 6, dday: 7, weather: 8, gemini: 9,
};

const TYPE_PREFIX = {
  calendar: 'cal', drive: 'wk', todo: 'memo', category: 'cat',
  clock: 'clock', sticky: 'note', pomodoro: 'pomo', dday: 'dday',
  weather: 'wx', gemini: 'ai',
};

const WIDGET_TITLES = {
  calendar: '내 캘린더',
  drive: 'Weekly Plan',
  todo: '메모 · 할 일',
  category: '카테고리',
  clock: '시계',
  sticky: '스티키 메모',
  pomodoro: '뽀모도로',
  dday: 'D-Day',
  weather: '날씨',
  gemini: 'Gemini',
};

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';

function stateWidgetsToLayout(widgets) {
  if (!Array.isArray(widgets)) return [];
  return widgets.map((w) => ({
    i: w.id,
    x: w.x ?? 0,
    y: w.y ?? 0,
    w: w.w ?? 2,
    h: w.h ?? 2,
    minW: w.minW ?? 1,
    minH: w.minH ?? 1,
  }));
}

function applyLayoutToStateWidgets(widgets, layout) {
  if (!Array.isArray(widgets) || !Array.isArray(layout)) return widgets;
  const byId = new Map(layout.map((el) => [el.i, el]));
  return widgets.map((w) => {
    const el = byId.get(w.id);
    if (!el) return { ...w };
    return { ...w, x: el.x, y: el.y, w: el.w, h: el.h };
  });
}

function enrichWidget(widget) {
  const d = WIDGET_DEFAULTS[widget.type] || { w: 2, h: 2, minW: 2, minH: 2 };
  return {
    ...widget,
    w: widget.w ?? d.w,
    h: widget.h ?? d.h,
    minW: widget.minW ?? d.minW,
    minH: widget.minH ?? d.minH,
  };
}

let saveTimer = null;
const SAVE_DEBOUNCE_MS = 300;

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function parseJsonSafe(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function snapshotGet(snapshot, key) {
  if (snapshot == null) return undefined;
  if (typeof snapshot.getItem === 'function') return snapshot.getItem(key);
  return snapshot[key];
}

/** 빈 schema 3 상태 골격 */
export function createEmptyState() {
  return {
    schema: SCHEMA_VERSION,
    grid: { cols: GRID_COLS },
    widgets: [],
    memos: {},
    settings: {
      scale: 100,
      setupDone: false,
      calAlarms: {},
      gtasksLastSync: null,
      driveMemoId: '',
    },
    secrets: {},
    geminiChats: [],
  };
}

/** @returns {string} */
export function generateChatId() {
  const n = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 9);
  return `chat-${n}-${r}`;
}

/** 신규 사용자 기본 4종 위젯 시드 */
export function seedDefaultWidgets(state) {
  const next = cloneState(state);
  if (Array.isArray(next.widgets) && next.widgets.length > 0) {
    return next;
  }
  next.widgets = [
    {
      id: 'cal-1',
      type: 'calendar',
      title: '내 캘린더',
      source: { calendarId: 'primary' },
    },
    {
      id: 'wk-1',
      type: 'drive',
      title: 'Weekly Plan',
      source: { folderId: '' },
    },
    {
      id: 'memo-1',
      type: 'todo',
      source: { taskListId: '' },
      items: [],
    },
    {
      id: 'cat-1',
      type: 'category',
      title: '카테고리',
      color: '#ffb3b3',
      icon: '📚',
      items: [],
    },
  ];
  next.widgets = autoPackWidgets(next.widgets);
  return next;
}

/** w/h/min 부여 후 compactVertical로 결정론적 배치 */
export function autoPackWidgets(widgets) {
  const enriched = widgets.map((w) => {
    const d = WIDGET_DEFAULTS[w.type] || { w: 2, h: 2, minW: 2, minH: 2 };
    return {
      ...w,
      w: w.w ?? d.w,
      h: w.h ?? d.h,
      minW: w.minW ?? d.minW,
      minH: w.minH ?? d.minH,
    };
  });

  const sorted = [...enriched].sort((a, b) => {
    const oa = TYPE_ORDER[a.type] ?? 99;
    const ob = TYPE_ORDER[b.type] ?? 99;
    if (oa !== ob) return oa - ob;
    return String(a.id).localeCompare(String(b.id));
  });

  let y = 0;
  const layout = sorted.map((w) => {
    const item = {
      i: w.id,
      x: 0,
      y,
      w: w.w,
      h: w.h,
      minW: w.minW,
      minH: w.minH,
    };
    y += w.h;
    return item;
  });

  const packed = compactVertical(layout);
  return sorted.map((w) => {
    const p = packed.find((el) => el.i === w.id);
    return { ...w, x: p.x, y: p.y };
  });
}

/**
 * localStorage 스냅샷 → 통합 JSON (순수 함수, node 테스트용)
 * @param {Record<string,string>|{getItem:(k:string)=>string|null}} snapshot
 * @param {{ migratedAt?: string }} [options]
 */
function isEmptySnapshot(snapshot) {
  if (snapshot == null || typeof snapshot !== 'object') return true;
  const keys = Object.keys(snapshot).filter(
    (k) => snapshot[k] != null && String(snapshot[k]) !== '',
  );
  return keys.length === 0;
}

export function buildStateFromLocalStorage(snapshot, options = {}) {
  const migratedAt = options.migratedAt ?? '1970-01-01T00:00:00.000Z';

  if (isEmptySnapshot(snapshot)) {
    const seeded = seedDefaultWidgets(createEmptyState());
    seeded._migrated = true;
    seeded._migratedAt = migratedAt;
    return seeded;
  }

  const base = createEmptyState();

  const scaleRaw = snapshotGet(snapshot, 'appScale');
  if (scaleRaw != null) {
    const scale = parseInt(String(scaleRaw), 10);
    if (!Number.isNaN(scale)) base.settings.scale = scale;
  }

  const setupDone = snapshotGet(snapshot, 'setupDone');
  base.settings.setupDone = setupDone === '1' || setupDone === 'true';

  const driveMemoId = snapshotGet(snapshot, 'driveMemoId');
  if (driveMemoId != null) base.settings.driveMemoId = String(driveMemoId);

  const gtasksLastSync = snapshotGet(snapshot, 'gtasksLastSync');
  if (gtasksLastSync != null) {
    const n = parseInt(String(gtasksLastSync), 10);
    base.settings.gtasksLastSync = Number.isNaN(n) ? null : n;
  }

  const calAlarmsRaw = snapshotGet(snapshot, 'calAlarms');
  base.settings.calAlarms = parseJsonSafe(calAlarmsRaw, {});

  const driveWeeklyId = snapshotGet(snapshot, 'driveWeeklyId') || '';
  const weeklyTitle = snapshotGet(snapshot, 'weeklyPlanTitle') || 'Weekly Plan';
  const gtasksListId = snapshotGet(snapshot, 'gtasksListId') || '';
  const todos = parseJsonSafe(snapshotGet(snapshot, 'appTodos'), []);
  const cats = parseJsonSafe(snapshotGet(snapshot, 'appCats'), []);

  const widgets = [];

  widgets.push({
    id: 'cal-1',
    type: 'calendar',
    title: '내 캘린더',
    source: { calendarId: 'primary' },
  });

  widgets.push({
    id: 'wk-1',
    type: 'drive',
    title: String(weeklyTitle),
    source: { folderId: String(driveWeeklyId) },
  });

  widgets.push({
    id: 'memo-1',
    type: 'todo',
    source: { taskListId: String(gtasksListId) },
    items: Array.isArray(todos) ? todos : [],
  });

  if (Array.isArray(cats)) {
    cats.forEach((cat, idx) => {
      widgets.push({
        id: `cat-${idx + 1}`,
        type: 'category',
        title: cat.name || cat.title || `카테고리 ${idx + 1}`,
        color: cat.color || '#ffb3b3',
        icon: cat.icon || '📚',
        items: Array.isArray(cat.items) ? cat.items : [],
        note: cat.note || '',
        driveRootId: cat.driveRootId || '',
        catType: cat.type || 'normal',
      });
    });
  }

  if (widgets.length === 0) {
    base.widgets = seedDefaultWidgets(base).widgets;
  } else {
    base.widgets = autoPackWidgets(widgets);
  }

  base._migrated = true;
  base._migratedAt = migratedAt;
  return base;
}

/** _migrated 상태면 재변환 없이 복제 반환 */
export function applyMigrationIdempotent(state) {
  if (state && state._migrated === true) {
    return cloneState(state);
  }
  return state;
}

/** JSON 문자열 파싱 — 알 수 없는 필드 보존, 손상 시 null */
export function parseStateJson(text) {
  if (text == null || String(text).trim() === '') return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function collectLocalStorageSnapshot() {
  if (typeof localStorage === 'undefined') return {};
  const keys = [
    'appCats', 'appTodos', 'appScale', 'setupDone',
    'driveWeeklyId', 'driveMemoId', 'gtasksListId',
    'gtasksLastSync', 'calAlarms', 'weeklyPlanTitle',
  ];
  const snap = {};
  for (const key of keys) {
    const val = localStorage.getItem(key);
    if (val != null) snap[key] = val;
  }
  return snap;
}

async function getFsApi() {
  const { mkdir, readTextFile, writeTextFile, rename, exists, copyFile, remove } =
    await import('@tauri-apps/plugin-fs');
  const { BaseDirectory } = await import('@tauri-apps/plugin-fs');
  return { mkdir, readTextFile, writeTextFile, rename, exists, copyFile, remove, BaseDirectory };
}

async function ensureAppDataDir(fs) {
  await fs.mkdir('', { baseDir: fs.BaseDirectory.AppData, recursive: true });
}

async function rotateBackups(fs) {
  const { BaseDirectory } = fs;
  const mainExists = await fs.exists(STATE_FILE, { baseDir: BaseDirectory.AppData });
  if (!mainExists) return;

  const oldest = `${STATE_FILE}.bak.${BACKUP_COUNT}`;
  if (await fs.exists(oldest, { baseDir: BaseDirectory.AppData })) {
    await fs.remove(oldest, { baseDir: BaseDirectory.AppData });
  }

  for (let i = BACKUP_COUNT - 1; i >= 1; i--) {
    const from = `${STATE_FILE}.bak.${i}`;
    const to = `${STATE_FILE}.bak.${i + 1}`;
    if (await fs.exists(from, { baseDir: BaseDirectory.AppData })) {
      await fs.copyFile(from, to, {
        fromBaseDir: BaseDirectory.AppData,
        toBaseDir: BaseDirectory.AppData,
      });
      await fs.remove(from, { baseDir: BaseDirectory.AppData });
    }
  }

  await fs.copyFile(STATE_FILE, `${STATE_FILE}.bak.1`, {
    fromBaseDir: BaseDirectory.AppData,
    toBaseDir: BaseDirectory.AppData,
  });
}

async function writeStateAtomic(fs, state) {
  const { BaseDirectory } = fs;
  await ensureAppDataDir(fs);
  const json = `${JSON.stringify(state, null, 2)}\n`;
  await fs.writeTextFile(STATE_TMP, json, { baseDir: BaseDirectory.AppData });
  await rotateBackups(fs);
  const tmpExists = await fs.exists(STATE_TMP, { baseDir: BaseDirectory.AppData });
  const mainExists = await fs.exists(STATE_FILE, { baseDir: BaseDirectory.AppData });
  if (mainExists) {
    await fs.remove(STATE_FILE, { baseDir: BaseDirectory.AppData });
  }
  if (tmpExists) {
    await fs.rename(STATE_TMP, STATE_FILE, {
      oldPathBaseDir: BaseDirectory.AppData,
      newPathBaseDir: BaseDirectory.AppData,
    });
  }
}

/** Tauri AppData에서 상태 로드. 없으면 localStorage 마이그레이션 시도. */
export async function loadState() {
  const fs = await getFsApi();
  await ensureAppDataDir(fs);

  const raw = await fs.readTextFile(STATE_FILE, {
    baseDir: fs.BaseDirectory.AppData,
  }).catch(() => null);

  if (raw) {
    const parsed = parseStateJson(raw);
    if (parsed) return applyMigrationIdempotent(parsed);
  }

  return migrateFromLocalStorage();
}

/** 디바운스·원자적 쓰기·롤링 백업 */
export async function saveState(state, options = {}) {
  const { immediate = false } = options;
  const payload = cloneState(state);

  const run = async () => {
    const fs = await getFsApi();
    await writeStateAtomic(fs, payload);
  };

  if (immediate) {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    await run();
    return;
  }

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    run().catch((err) => console.warn('saveState error:', err));
  }, SAVE_DEBOUNCE_MS);
}

/** 1회 멱등 localStorage → JSON 이전 */
export async function migrateFromLocalStorage() {
  const fs = await getFsApi();
  await ensureAppDataDir(fs);

  const existingRaw = await fs.readTextFile(STATE_FILE, {
    baseDir: fs.BaseDirectory.AppData,
  }).catch(() => null);

  if (existingRaw) {
    const existing = parseStateJson(existingRaw);
    if (existing && existing._migrated === true) {
      return applyMigrationIdempotent(existing);
    }
  }

  const snapshot = collectLocalStorageSnapshot();
  const backupName = `localStorage-backup-${Date.now()}.json`;
  await fs.writeTextFile(
    backupName,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    { baseDir: fs.BaseDirectory.AppData },
  );

  const state = buildStateFromLocalStorage(snapshot, {
    migratedAt: new Date().toISOString(),
  });
  await writeStateAtomic(fs, state);
  return state;
}

/** 단계 13 UI 대비 골격 — 키 제외 옵션 */
export function exportState(state, { includeKeys = true } = {}) {
  const out = cloneState(state);
  if (!includeKeys && out.secrets) {
    out.secrets = {};
  }
  return JSON.stringify(out, null, 2);
}

/** 기존 ID와 충돌 없는 위젯 ID 생성 */
export function generateWidgetId(type, widgets) {
  const prefix = TYPE_PREFIX[type] || 'w';
  const ids = new Set((widgets || []).map((w) => w.id));
  let n = 1;
  while (ids.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

/** 타입별 기본 골격 위젯 객체 */
export function createWidget(type, widgets) {
  const id = generateWidgetId(type, widgets);
  const base = { id, type };
  if (type === 'calendar') {
    return { ...base, title: WIDGET_TITLES.calendar, source: { calendarId: 'primary' } };
  }
  if (type === 'drive') {
    return { ...base, title: WIDGET_TITLES.drive, source: { folderId: '' } };
  }
  if (type === 'todo') {
    return { ...base, title: WIDGET_TITLES.todo, source: { taskListId: '' }, items: [] };
  }
  if (type === 'category') {
    const n = parseInt(String(id).replace('cat-', ''), 10) || 1;
    const colors = ['#ffb3b3', '#ffc998', '#ffe08a', '#a7f3c0', '#93c5fd'];
    const color = colors[(n - 1) % colors.length];
    return {
      ...base,
      title: `카테고리 ${n}`,
      color,
      icon: '📚',
      items: [],
      note: '',
      driveRootId: '',
      catType: 'normal',
    };
  }
  if (type === 'clock') {
    return {
      ...base,
      title: WIDGET_TITLES.clock,
      config: { tz: 'Asia/Seoul', format24: true },
    };
  }
  if (type === 'sticky') {
    return { ...base, title: WIDGET_TITLES.sticky, text: '' };
  }
  if (type === 'pomodoro') {
    return {
      ...base,
      title: WIDGET_TITLES.pomodoro,
      config: { workMin: 25, breakMin: 5, phase: 'idle', endsAt: null },
    };
  }
  if (type === 'dday') {
    return {
      ...base,
      title: WIDGET_TITLES.dday,
      config: { date: '2026-12-31', label: '마감' },
    };
  }
  if (type === 'weather') {
    return {
      ...base,
      title: WIDGET_TITLES.weather,
      config: {
        loc: 'Seoul',
        unit: 'c',
        latitude: 37.5665,
        longitude: 126.9780,
        placeName: '서울',
      },
    };
  }
  if (type === 'gemini') {
    return {
      ...base,
      title: WIDGET_TITLES.gemini,
      config: {
        model: DEFAULT_GEMINI_MODEL,
        activeChatId: null,
      },
    };
  }
  throw new Error(`Unknown widget type: ${type}`);
}

/** 위젯 추가 + 하단 배치 후 compactVertical */
export function addWidget(state, type) {
  const next = cloneState(state);
  const widget = enrichWidget(createWidget(type, next.widgets));
  const layout = stateWidgetsToLayout(next.widgets);
  const maxY = layout.reduce((m, el) => Math.max(m, el.y + el.h), 0);
  widget.x = 0;
  widget.y = maxY;
  next.widgets.push(widget);
  const packed = compactVertical(stateWidgetsToLayout(next.widgets));
  next.widgets = applyLayoutToStateWidgets(next.widgets, packed);
  return next;
}

/** 위젯 삭제 + compactVertical 재배치 (빈 그리드 허용) */
export function removeWidget(state, widgetId) {
  const next = cloneState(state);
  next.widgets = next.widgets.filter((w) => w.id !== widgetId);
  if (Array.isArray(next.geminiChats)) {
    next.geminiChats = next.geminiChats.filter((c) => c.widgetId !== widgetId);
  }
  if (next.widgets.length > 0) {
    const packed = compactVertical(stateWidgetsToLayout(next.widgets));
    next.widgets = applyLayoutToStateWidgets(next.widgets, packed);
  }
  return next;
}

/** 위젯 제목·소스 등 부분 갱신 */
export function updateWidgetSource(state, widgetId, patch) {
  const next = cloneState(state);
  next.widgets = next.widgets.map((w) => {
    if (w.id !== widgetId) return w;
    const updated = { ...w };
    if (patch.title !== undefined) updated.title = patch.title;
    if (patch.source !== undefined) {
      updated.source = { ...(w.source || {}), ...patch.source };
    }
    if (patch.color !== undefined) updated.color = patch.color;
    if (patch.icon !== undefined) updated.icon = patch.icon;
    if (patch.config !== undefined) {
      updated.config = { ...(w.config || {}), ...patch.config };
    }
    if (patch.text !== undefined) updated.text = patch.text;
    return updated;
  });
  return next;
}

/** secrets 부분 갱신 */
export function updateStateSecrets(state, patch) {
  const next = cloneState(state);
  next.secrets = { ...(next.secrets || {}), ...patch };
  return next;
}

/** @param {object} state @param {string} widgetId */
export function listGeminiChatsForWidget(state, widgetId) {
  const chats = Array.isArray(state?.geminiChats) ? state.geminiChats : [];
  return chats
    .filter((c) => c.widgetId === widgetId)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** @param {object} state @param {string} widgetId */
export function createGeminiChat(state, widgetId) {
  const next = cloneState(state);
  if (!Array.isArray(next.geminiChats)) next.geminiChats = [];
  const widget = next.widgets.find((w) => w.id === widgetId);
  const model = widget?.config?.model || DEFAULT_GEMINI_MODEL;
  const now = new Date().toISOString();
  const chat = {
    id: generateChatId(),
    widgetId,
    title: '새 대화',
    model,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  next.geminiChats.push(chat);
  next.widgets = next.widgets.map((w) => {
    if (w.id !== widgetId) return w;
    return { ...w, config: { ...(w.config || {}), activeChatId: chat.id } };
  });
  return next;
}

/** @param {object} state @param {string} chatId @param {object} message */
export function appendGeminiMessage(state, chatId, message) {
  const next = cloneState(state);
  if (!Array.isArray(next.geminiChats)) next.geminiChats = [];
  const now = new Date().toISOString();
  next.geminiChats = next.geminiChats.map((c) => {
    if (c.id !== chatId) return c;
    const messages = [...(c.messages || []), message];
    return { ...c, messages, updatedAt: now };
  });
  return next;
}

/** @param {object} state @param {string} chatId @param {string} title */
export function updateGeminiChatTitle(state, chatId, title) {
  const next = cloneState(state);
  if (!Array.isArray(next.geminiChats)) return next;
  const now = new Date().toISOString();
  next.geminiChats = next.geminiChats.map((c) => {
    if (c.id !== chatId) return c;
    return { ...c, title: title || c.title, updatedAt: now };
  });
  return next;
}

/** @param {object} state @param {string} chatId */
export function deleteGeminiChat(state, chatId) {
  const next = cloneState(state);
  if (!Array.isArray(next.geminiChats)) return next;
  const removed = next.geminiChats.find((c) => c.id === chatId);
  next.geminiChats = next.geminiChats.filter((c) => c.id !== chatId);
  if (removed) {
    next.widgets = next.widgets.map((w) => {
      if (w.id !== removed.widgetId) return w;
      if (w.config?.activeChatId !== chatId) return w;
      const remaining = next.geminiChats.filter((c) => c.widgetId === w.id);
      return {
        ...w,
        config: { ...(w.config || {}), activeChatId: remaining[0]?.id || null },
      };
    });
  }
  return next;
}

/** @param {object} state @param {string} widgetId @param {string} chatId */
export function setActiveGeminiChat(state, widgetId, chatId) {
  const next = cloneState(state);
  next.widgets = next.widgets.map((w) => {
    if (w.id !== widgetId) return w;
    return { ...w, config: { ...(w.config || {}), activeChatId: chatId } };
  });
  return next;
}

/** @param {object} state @param {string} chatId */
export function getGeminiChat(state, chatId) {
  return (state?.geminiChats || []).find((c) => c.id === chatId) || null;
}

/** version 호환 검사 후 상태 반환 (미래 버전 거부) */
export function importState(text) {
  const parsed = parseStateJson(text);
  if (!parsed) {
    throw new Error('Invalid state JSON');
  }
  if (typeof parsed.schema === 'number' && parsed.schema > SCHEMA_VERSION) {
    throw new Error(`Unsupported schema version: ${parsed.schema}`);
  }
  return parsed;
}
