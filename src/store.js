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

import { compactVertical, compactLayout, GRID_COLS, collides, packLayoutFirstFit } from './layout-engine.js';

export const SCHEMA_VERSION = 3;
export const STATE_FILE = 'dashboard-state.json';
export const STATE_TMP = 'dashboard-state.json.tmp';
export const BACKUP_COUNT = 5;

const WIDGET_DEFAULTS = {
  calendar: { w: 4, h: 4, minW: 3, minH: 3 },
  drive: { w: 3, h: 3, minW: 3, minH: 2 },
  todo: { w: 3, h: 3, minW: 3, minH: 2 },
  gsheets: { w: 3, h: 3, minW: 2, minH: 2 },
  gslides: { w: 3, h: 3, minW: 2, minH: 2 },
  gdocs: { w: 3, h: 3, minW: 2, minH: 2 },
  category: { w: 2, h: 2, minW: 2, minH: 2 },
  clock: { w: 2, h: 2, minW: 2, minH: 2 },
  sticky: { w: 2, h: 2, minW: 2, minH: 2 },
  pomodoro: { w: 2, h: 2, minW: 2, minH: 2 },
  dday: { w: 2, h: 2, minW: 2, minH: 2 },
  weather: { w: 3, h: 2, minW: 2, minH: 2 },
  gemini: { w: 4, h: 3, minW: 3, minH: 2 },
};

const TYPE_ORDER = {
  calendar: 0, drive: 1, todo: 2, gsheets: 3, gslides: 4, gdocs: 5, category: 6,
  clock: 7, sticky: 8, pomodoro: 9, dday: 10, weather: 11, gemini: 12,
};

const TYPE_PREFIX = {
  calendar: 'cal', drive: 'wk', todo: 'memo', gsheets: 'sht', gslides: 'sld', gdocs: 'gdoc',
  category: 'cat', clock: 'clock', sticky: 'note', pomodoro: 'pomo', dday: 'dday',
  weather: 'wx', gemini: 'ai',
};

const WIDGET_TITLES = {
  calendar: '내 캘린더',
  drive: 'Weekly Plan',
  todo: '메모 · 할 일',
  gsheets: 'Google Sheets',
  gslides: 'Google Slides',
  gdocs: 'Google Docs',
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

const LEGACY_WIDGET_H = {
  calendar: 4,
  todo: 4,
  gemini: 4,
};

function enrichWidget(widget) {
  const d = WIDGET_DEFAULTS[widget.type] || { w: 2, h: 2, minW: 2, minH: 2 };
  const minW = d.minW;
  const minH = d.minH;
  let w = Math.max(widget.w ?? d.w, minW);
  let h = Math.max(widget.h ?? d.h, minH);
  const legacyH = LEGACY_WIDGET_H[widget.type];
  if (legacyH && (widget.h ?? legacyH) >= legacyH && d.h < legacyH) {
    h = Math.max(d.h, minH);
  }
  const title = widget.title || WIDGET_TITLES[widget.type] || widget.id;
  return {
    ...widget,
    title,
    w,
    h,
    minW,
    minH,
  };
}

let saveTimer = null;
let pendingSavePayload = null;
let writeChain = Promise.resolve();
const SAVE_DEBOUNCE_MS = 300;

function enqueueStateWrite(task) {
  const next = writeChain.then(task, task);
  writeChain = next.catch(() => {});
  return next;
}

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

/** 신규 사용자 기본 7종 위젯 시드 — 12열 2행 그리드 */
export function seedDefaultWidgets(state) {
  const next = cloneState(state);
  if (Array.isArray(next.widgets) && next.widgets.length > 0) {
    return next;
  }
  // Row 1 (y=0, h=5): 캘린더(6) | 카테고리1(3) | 카테고리2(3)
  // Row 2 (y=5, h=4): 할일(3) | 구글시트(3) | 구글드라이브(3) | 제미나이(3)
  next.widgets = [
    {
      id: 'cal-1',
      type: 'calendar',
      title: '내 캘린더',
      source: { calendarIds: ['primary'], calendarId: 'primary' },
      x: 0, y: 0, w: 6, h: 5,
    },
    {
      id: 'cat-1',
      type: 'category',
      title: '카테고리 1',
      color: '#ffb3b3',
      icon: '📁',
      items: [],
      x: 6, y: 0, w: 3, h: 5,
    },
    {
      id: 'cat-2',
      type: 'category',
      title: '카테고리 2',
      color: '#b3d9ff',
      icon: '📂',
      items: [],
      x: 9, y: 0, w: 3, h: 5,
    },
    {
      id: 'todo-1',
      type: 'todo',
      title: WIDGET_TITLES.todo,
      source: { taskListId: '' },
      items: [],
      x: 0, y: 5, w: 3, h: 4,
    },
    {
      id: 'gs-1',
      type: 'gsheets',
      title: 'Google Sheets',
      source: { fileId: '' },
      x: 3, y: 5, w: 3, h: 4,
    },
    {
      id: 'wk-1',
      type: 'drive',
      title: 'Weekly Plan',
      source: { folderId: '' },
      x: 6, y: 5, w: 3, h: 4,
    },
    {
      id: 'gem-1',
      type: 'gemini',
      title: 'Gemini',
      source: {},
      x: 9, y: 5, w: 3, h: 4,
    },
  ];
  next.widgets = next.widgets.map((w) => enrichWidget(w));
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

  const layout = sorted.map((w) => ({
    i: w.id,
    x: w.x ?? 0,
    y: w.y ?? 0,
    w: w.w,
    h: w.h,
    minW: w.minW,
    minH: w.minH,
  }));

  const packed = compactVertical(packLayoutFirstFit(layout));
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
    title: WIDGET_TITLES.todo,
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

/** Tauri WebView — bare npm import 불가(frontendDist=src만 배포). invoke 브리지 사용 */
async function getFsApi() {
  const tauri = typeof window !== 'undefined' ? window.__TAURI__ : null;
  const invoke = tauri?.core?.invoke;
  if (typeof invoke !== 'function') {
    throw new Error('Tauri FS unavailable');
  }

  const BaseDirectory = { AppData: 4 };

  const readTextFile = async (path, options) => {
    const arr = await invoke('plugin:fs|read_text_file', { path, options });
    const bytes = arr instanceof ArrayBuffer ? new Uint8Array(arr) : Uint8Array.from(arr);
    return new TextDecoder(options?.encoding ?? 'utf-8').decode(bytes);
  };

  const writeTextFile = async (path, data, options) => {
    const body = new TextEncoder().encode(data);
    await invoke('plugin:fs|write_text_file', body, {
      headers: {
        path: encodeURIComponent(path),
        options: JSON.stringify(options ?? {}),
      },
    });
  };

  return {
    BaseDirectory,
    mkdir: (path, options) => invoke('plugin:fs|mkdir', { path, options }),
    readTextFile,
    writeTextFile,
    rename: (oldPath, newPath, options) => invoke('plugin:fs|rename', { oldPath, newPath, options }),
    exists: (path, options) => invoke('plugin:fs|exists', { path, options }),
    copyFile: (fromPath, toPath, options) => invoke('plugin:fs|copy_file', { fromPath, toPath, options }),
    remove: (path, options) => invoke('plugin:fs|remove', { path, options }),
  };
}

function layoutHasOverlap(widgets) {
  const layout = stateWidgetsToLayout(widgets);
  for (let i = 0; i < layout.length; i++) {
    for (let j = i + 1; j < layout.length; j++) {
      if (collides(layout[i], layout[j])) return true;
    }
  }
  return false;
}

/** 예전 자동배치(전부 x=0 세로 스택) 여부 */
function isLegacySingleColumnLayout(widgets) {
  if (!Array.isArray(widgets) || widgets.length < 2) return false;
  return widgets.every((w) => (w.x ?? 0) === 0);
}

/** 12열 그리드 기준 좌표 보정 + 겹침/미배치 시 자동 배치 + 항상 위쪽 압축 */
export function normalizeWidgetLayout(state, { force = false } = {}) {
  const next = cloneState(state ?? createEmptyState());
  next.grid = { cols: GRID_COLS };
  const widgets = (next.widgets || []).map((w) => enrichWidget(w));
  const needsPack = force
    || widgets.some((w) => w.x == null || w.y == null)
    || layoutHasOverlap(widgets)
    || isLegacySingleColumnLayout(widgets);
  const packed = needsPack ? autoPackWidgets(widgets) : widgets;
  // 유효한 저장 배치는 그대로 보존 — compactHorizontal 은 x 좌표를 왼쪽으로 당겨 재시작 시 위치가 틀어진다
  const layout = needsPack
    ? compactLayout(packed.map((w) => ({
      i: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minW: w.minW, minH: w.minH,
    })))
    : packed.map((w) => ({
      i: w.id, x: w.x ?? 0, y: w.y ?? 0, w: w.w, h: w.h, minW: w.minW, minH: w.minH,
    }));
  next.widgets = packed.map((w) => {
    const pos = layout.find((el) => el.i === w.id);
    return pos ? { ...w, x: pos.x, y: pos.y } : w;
  });
  return next;
}

function ensureWidgetStateSeeded(state) {
  let next = hydrateGeminiApiKey(state ?? createEmptyState());
  if (!Array.isArray(next.widgets) || next.widgets.length === 0) {
    next = seedDefaultWidgets(next);
  }
  return normalizeWidgetLayout(next);
}

async function ensureAppDataDir(fs) {
  await fs.mkdir('', { baseDir: fs.BaseDirectory.AppData, recursive: true });
}

async function rotateBackups(fs) {
  try {
    const { BaseDirectory } = fs;
    if (!(await fs.exists(STATE_FILE, { baseDir: BaseDirectory.AppData }))) return;

    const oldest = `${STATE_FILE}.bak.${BACKUP_COUNT}`;
    if (await fs.exists(oldest, { baseDir: BaseDirectory.AppData })) {
      await fs.remove(oldest, { baseDir: BaseDirectory.AppData });
    }

    for (let i = BACKUP_COUNT - 1; i >= 1; i--) {
      const from = `${STATE_FILE}.bak.${i}`;
      const to = `${STATE_FILE}.bak.${i + 1}`;
      if (!(await fs.exists(from, { baseDir: BaseDirectory.AppData }))) continue;
      await fs.copyFile(from, to, {
        fromBaseDir: BaseDirectory.AppData,
        toBaseDir: BaseDirectory.AppData,
      });
      await fs.remove(from, { baseDir: BaseDirectory.AppData });
    }

    if (await fs.exists(STATE_FILE, { baseDir: BaseDirectory.AppData })) {
      await fs.copyFile(STATE_FILE, `${STATE_FILE}.bak.1`, {
        fromBaseDir: BaseDirectory.AppData,
        toBaseDir: BaseDirectory.AppData,
      });
    }
  } catch (err) {
    console.warn('[store] rotateBackups skipped:', err);
  }
}

async function writeStateAtomic(fs, state) {
  return enqueueStateWrite(async () => {
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
  });
}

/** Tauri AppData에서 상태 로드. 없으면 localStorage 마이그레이션 시도. */
export async function loadState() {
  try {
    const fs = await getFsApi();
    await ensureAppDataDir(fs);

    const raw = await fs.readTextFile(STATE_FILE, {
      baseDir: fs.BaseDirectory.AppData,
    }).catch(() => null);

    if (raw) {
      const parsed = parseStateJson(raw);
      if (parsed) {
        return ensureWidgetStateSeeded(applyMigrationIdempotent(parsed));
      }
    }

    return ensureWidgetStateSeeded(await migrateFromLocalStorage());
  } catch (err) {
    console.warn('[store] loadState FS failed, using localStorage fallback:', err);
    const snap = collectLocalStorageSnapshot();
    return ensureWidgetStateSeeded(
      buildStateFromLocalStorage(snap, { migratedAt: new Date().toISOString() }),
    );
  }
}

/** 디바운스·원자적 쓰기·롤링 백업 */
export async function saveState(state, options = {}) {
  const { immediate = false } = options;
  const payload = cloneState(state);
  pendingSavePayload = payload;

  const run = async () => {
    pendingSavePayload = null;
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

/** 대기 중인 저장을 즉시 디스크에 반영 (업데이트 설치 전 등) */
export async function flushSaveState(state) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const payload = state ?? pendingSavePayload;
  pendingSavePayload = null;
  if (!payload) return;
  await saveState(payload, { immediate: true });
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
    return { ...base, title: WIDGET_TITLES.calendar, source: { calendarIds: ['primary'], calendarId: 'primary' } };
  }
  if (type === 'drive') {
    return { ...base, title: WIDGET_TITLES.drive, source: { folderId: '' } };
  }
  if (type === 'todo') {
    return { ...base, title: WIDGET_TITLES.todo, source: { taskListId: '' }, items: [] };
  }
  if (type === 'gsheets' || type === 'gslides' || type === 'gdocs') {
    return { ...base, title: WIDGET_TITLES[type], source: {} };
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

/** 위→아래, 좌→우 순으로 빈 첫 자리를 찾아 반환 */
function findFirstFitSpot(layout, w, h, cols = GRID_COLS) {
  for (let y = 0; y < 96; y++) {
    for (let x = 0; x <= cols - w; x++) {
      const probe = { i: '__probe__', x, y, w, h };
      if (!layout.some((other) => collides(probe, other))) return { x, y };
    }
  }
  const fallbackY = layout.reduce((m, el) => Math.max(m, el.y + el.h), 0);
  return { x: 0, y: fallbackY };
}

/** 위젯 추가 — 위쪽부터 빈 자리에 배치 후 compactLayout */
export function addWidget(state, type) {
  const next = cloneState(state);
  const widget = enrichWidget(createWidget(type, next.widgets));
  const layout = stateWidgetsToLayout(next.widgets);
  const spot = findFirstFitSpot(layout, widget.w, widget.h);
  widget.x = spot.x;
  widget.y = spot.y;
  next.widgets.push(widget);
  const packed = compactLayout(stateWidgetsToLayout(next.widgets));
  next.widgets = applyLayoutToStateWidgets(next.widgets, packed);
  return next;
}

/** 위젯 삭제 + compactLayout 재배치 */
export function removeWidget(state, widgetId) {
  const next = cloneState(state);
  next.widgets = next.widgets.filter((w) => w.id !== widgetId);
  if (Array.isArray(next.geminiChats)) {
    next.geminiChats = next.geminiChats.filter((c) => c.widgetId !== widgetId);
  }
  if (next.widgets.length > 0) {
    const packed = compactLayout(stateWidgetsToLayout(next.widgets));
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

/** secrets 부분 갱신 (Gemini API 키는 settings·localStorage에도 백업) */
export function updateStateSecrets(state, patch) {
  const next = cloneState(state);
  next.secrets = { ...(next.secrets || {}), ...patch };
  if (patch.geminiApiKey !== undefined) {
    next.settings = { ...(next.settings || {}), geminiApiKey: patch.geminiApiKey };
    if (typeof localStorage !== 'undefined') {
      if (patch.geminiApiKey) localStorage.setItem('geminiApiKey', patch.geminiApiKey);
      else localStorage.removeItem('geminiApiKey');
    }
  }
  return next;
}

/** 저장된 Gemini API 키 복원 (secrets → settings → localStorage) */
export function hydrateGeminiApiKey(state) {
  const next = cloneState(state ?? createEmptyState());
  if (!next.secrets || typeof next.secrets !== 'object') next.secrets = {};
  const current = String(next.secrets.geminiApiKey || '').trim();
  if (current) return next;
  const fromSettings = String(next.settings?.geminiApiKey || '').trim();
  const fromLs = typeof localStorage !== 'undefined'
    ? String(localStorage.getItem('geminiApiKey') || '').trim()
    : '';
  const key = fromSettings || fromLs;
  if (key) next.secrets.geminiApiKey = key;
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

/** @param {object} parsed */
export function validateImportState(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Invalid state JSON' };
  }
  if (typeof parsed.schema === 'number' && parsed.schema > SCHEMA_VERSION) {
    return { ok: false, error: 'Unsupported schema version' };
  }
  if (!Array.isArray(parsed.widgets)) {
    return { ok: false, error: 'Invalid state JSON' };
  }
  return { ok: true };
}

/** @param {object} parsed */
export function normalizeImportedState(parsed) {
  const next = cloneState(parsed);
  if (!Array.isArray(next.geminiChats)) next.geminiChats = [];
  if (!next.secrets || typeof next.secrets !== 'object') next.secrets = {};
  if (!next.memos || typeof next.memos !== 'object') next.memos = {};
  if (!next.settings || typeof next.settings !== 'object') {
    next.settings = createEmptyState().settings;
  }
  if (!next.grid || typeof next.grid !== 'object') {
    next.grid = { cols: GRID_COLS };
  }
  if (typeof next.schema !== 'number') next.schema = SCHEMA_VERSION;
  return hydrateGeminiApiKey(next);
}

/** 가져오기 = 전체 replace (부분 병합 없음) */
export function importState(text) {
  const parsed = parseStateJson(text);
  if (!parsed) {
    throw new Error('Invalid state JSON');
  }
  const validation = validateImportState(parsed);
  if (!validation.ok) {
    throw new Error(validation.error || 'Invalid state JSON');
  }
  return normalizeImportedState(parsed);
}
