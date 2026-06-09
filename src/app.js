/* ════════════════════════════════════════════════════════════════
   Tauri v2 — 모듈 임포트 & API 브리지
   [4단계] window.api.* 호출을 아래 함수들로 완전 대체한다.
   token-store.js / google-api.js 는 src/ 폴더에 있는 ES 모듈.
════════════════════════════════════════════════════════════════ */
import {
  isAuthenticated, loadTokens, saveTokens, clearTokens, checkMigration,
} from './token-store.js';
import {
  getAuthUrl, exchangeCodeForTokens, getValidAccessToken,
  getCalendarList, getCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent,
  listDriveFolder, listDriveImages, listDriveFilesByMime, getDriveImageData,
  driveTrashFile, driveMoveFile, driveDownloadFile, driveDownloadFolder,
  tasksGetDefaultList, getTaskLists, tasksListTasks, tasksCreateTask, tasksPatchTask, tasksDeleteTask,
  fetchGoogleUserProfile,
} from './google-api.js';
import {
  createGoogleCache,
  fetchCached,
  buildCalendarEventsKey,
  buildCalendarListKey,
  buildDriveMimeListKey,
  invalidateCache,
  DEFAULT_EVENTS_TTL_MS,
  DEFAULT_LIST_TTL_MS,
} from './google-cache.js';
import {
  loadState, saveState, flushSaveState, addWidget, removeWidget, updateWidgetSource, normalizeWidgetLayout,
  updateStateSecrets, createGeminiChat, appendGeminiMessage, updateGeminiChatTitle,
  deleteGeminiChat, setActiveGeminiChat, listGeminiChatsForWidget, getGeminiChat,
  exportState, importState, DEFAULT_GEMINI_MODEL,
} from './store.js';
import {
  mountWidgetGrid,
  remountWidgetGrid,
  pruneWidgetCell,
  isWidgetGridEnabled,
  collectPanelAnchors,
  enterEditMode,
  exitEditMode,
  isEditMode,
  getEditFocusWidgetId,
  isLayoutDirty,
  setContentSyncPaused,
  isContentSyncPaused,
} from './widget-grid.js';
import { computeDday, formatPomoTime } from './local-widgets.js';
import {
  geocodeLocation,
  fetchWeatherForecast,
  buildWeatherForecastKey,
  buildGeocodeKey,
  weatherCodeLabel,
  weatherCodeIcon,
  formatTemperature,
  DEFAULT_WEATHER_TTL_MS,
  DEFAULT_GEOCODE_TTL_MS,
} from './weather-api.js';
import {
  GEMINI_MODELS,
  streamGenerateContent,
  generateTitle,
  extractDocxText,
  extractXlsxText,
  uploadLargeFile,
  readFileAsBase64Part,
  readFileUriPart,
  arrayBufferToBase64,
  LARGE_FILE_BYTES,
} from './gemini.js';

/* ── Google Calendar 공유 캐시 (단계 8) ── */
import { snapToCurrentMonitor } from './js/window-control.js';
import { initLightbox, toggleDriveZoom } from './js/lightbox.js';
const _gcalCache = createGoogleCache();
const _wxCache = createGoogleCache({ defaultTtlMs: DEFAULT_WEATHER_TTL_MS });
const GCAL_EVENTS_TTL_MS = DEFAULT_EVENTS_TTL_MS;

let _activeCalendarWidgetId = null;
const _calWidgetState = new Map();

function resolveWidgetCalendarIds(widget) {
  if (!widget) return ['primary'];
  const ids = widget.source?.calendarIds;
  if (Array.isArray(ids) && ids.length) return [...ids];
  if (widget.source?.calendarId) return [widget.source.calendarId];
  return ['primary'];
}

function resolvePrimaryCalendarId() {
  const widgets = _widgetGridState?.widgets;
  if (!Array.isArray(widgets)) return 'primary';
  const wid = _activeCalendarWidgetId
    || widgets.find((w) => w.type === 'calendar')?.id;
  const w = widgets.find((x) => x.id === wid);
  return resolveWidgetCalendarIds(w)[0] || 'primary';
}

function getSelectedWsfCalendarIds() {
  const list = document.getElementById('wsfCalendarList');
  if (!list) return ['primary'];
  const ids = [...list.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);
  return ids.length ? ids : ['primary'];
}

async function populateWsfCalendarList(widget) {
  const listEl = document.getElementById('wsfCalendarList');
  if (!listEl) return;
  const selected = new Set(resolveWidgetCalendarIds(widget));
  listEl.innerHTML = '<div class="wsf-cal-hint">불러오는 중...</div>';
  const res = await fetchCalendarListCached();
  listEl.innerHTML = '';
  if (res.error) {
    listEl.innerHTML = `<div class="wsf-cal-hint">오류: ${res.error}</div>`;
    return;
  }
  const cals = res.calendars || [];
  if (!cals.length) {
    listEl.innerHTML = '<div class="wsf-cal-hint">캘린더가 없습니다</div>';
    return;
  }
  for (const c of cals) {
    const row = document.createElement('label');
    row.className = 'wsf-cal-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = c.id;
    cb.checked = selected.has(c.id);
    const dot = document.createElement('span');
    dot.className = 'wsf-cal-dot';
    dot.style.background = c.backgroundColor || '#8b5cf6';
    const name = document.createElement('span');
    name.className = 'wsf-cal-name';
    name.textContent = c.summary + (c.primary ? ' (기본)' : '');
    row.appendChild(cb);
    row.appendChild(dot);
    row.appendChild(name);
    listEl.appendChild(row);
  }
}

function calTierInlineLimit(widgetId) {
  const shell = document.querySelector(`.widget-cell[data-widget-id="${widgetId}"]`);
  const tier = shell?.dataset?.widgetTier || 'normal';
  const h = shell?.clientHeight || 0;
  if (tier === 'compact' || h < 220) return 0;
  if (tier === 'spacious' || h >= 360) return 4;
  if (h >= 300) return 3;
  return 2;
}

globalThis.__dashboardRerenderCalendar = (widgetId) => {
  if (widgetId) renderCalForWidget(widgetId);
};

function sortDayEvents(evs) {
  return [...evs].sort((a, b) => {
    if (a.allDay && !b.allDay) return -1;
    if (!a.allDay && b.allDay) return 1;
    if (a.t === '종일' && b.t !== '종일') return -1;
    if (a.t !== '종일' && b.t === '종일') return 1;
    return String(a.t).localeCompare(String(b.t));
  });
}

function buildCalendarColorMap(calendars) {
  const map = {};
  for (const c of calendars || []) {
    if (c?.id && c.backgroundColor) map[c.id] = c.backgroundColor;
  }
  return map;
}

async function fetchWidgetCalendarEvents(widget, timeMin, timeMax) {
  const ids = resolveWidgetCalendarIds(widget);
  const listRes = await fetchCalendarListCached();
  const colorMap = buildCalendarColorMap(listRes.calendars);
  const merged = [];
  for (const calId of ids) {
    const result = await fetchCalendarEventsCached(calId, timeMin, timeMax);
    if (result.error) continue;
    for (const ev of result.events || []) {
      merged.push({ ...ev, _calendarId: calId });
    }
  }
  return { events: merged, colorMap };
}

function setActiveCalendarWidget(widgetId) {
  _activeCalendarWidgetId = widgetId;
}

function invalidateCalendarEventsCache(calendarId) {
  const id = calendarId ?? resolvePrimaryCalendarId();
  invalidateCache(_gcalCache, `cal:events:${id}`);
}

async function fetchCalendarEventsCached(calendarId, timeMin, timeMax) {
  const calId = calendarId ?? resolvePrimaryCalendarId();
  const key = buildCalendarEventsKey(calId, timeMin, timeMax);
  return fetchCached(
    _gcalCache,
    key,
    GCAL_EVENTS_TTL_MS,
    () => getCalendarEvents({ calendarId: calId, timeMin, timeMax }),
  );
}

/* ── Tauri invoke / listen 단축 래퍼 ── */
const tInvoke = (cmd, args, opts) => window.__TAURI__.core.invoke(cmd, args, opts);
const tListen = (evt, cb)         => window.__TAURI__.event.listen(evt, cb);
/** Tauri v2 dialog — options 를 { options } 로 감싸야 함 */
const tDialogOpen = (options = {}) => tInvoke('plugin:dialog|open', { options });
const tDialogSave = (options = {}) => tInvoke('plugin:dialog|save', { options });

/* ── plugin-shell: URL / 파일 / 앱 열기 ── */
async function openPath(url) {
  try   { return await tInvoke('plugin:shell|open', { path: url }); }
  catch (e) { console.error('[openPath]', e); return { error: e.message }; }
}

async function openExternalUrl(url) {
  const r = await openPath(url);
  if (r?.error) window.open(url, '_blank', 'noopener');
}

function isWebUrl(p) {
  return /^https?:\/\//i.test(p) || /^mailto:/i.test(p) || /^tel:/i.test(p);
}

/** 카테고리 항목(로컬 경로·URL) — 탐색기/기본 앱으로 열기 */
async function openItemPath(item) {
  if (!item?.path) return { error: 'no path' };
  let p = String(item.path).trim();
  if (isWebUrl(p)) return openPath(p);
  if (/^file:\/\//i.test(p)) {
    try {
      p = decodeURIComponent(p.replace(/^file:\/\/\/?/i, ''));
    } catch {}
  }
  return openPath(p);
}

/** 카테고리 아이템 순서 변경 (같은/다른 패널, 특정 행 기준) */
function reorderCatItem(srcCat, srcItem, dstCat, dstItem, insertAbove) {
  const srcIdx = srcCat.items.indexOf(srcItem);
  if (srcIdx < 0) return false;
  srcCat.items.splice(srcIdx, 1);
  let dstIdx = dstCat.items.indexOf(dstItem);
  if (dstIdx < 0) return false;
  if (srcCat === dstCat && srcIdx < dstIdx) dstIdx--;
  dstCat.items.splice(insertAbove ? dstIdx : dstIdx + 1, 0, srcItem);
  return true;
}

/** 카테고리 맨 끝으로 이동 (다른 패널 빈 영역에 놓을 때) */
function moveItemToCatEnd(srcCat, srcItem, dstCat) {
  if (!dstCat) return false;
  const srcIdx = srcCat.items.indexOf(srcItem);
  if (srcIdx < 0) return false;
  srcCat.items.splice(srcIdx, 1);
  dstCat.items.push(srcItem);
  return true;
}

function catFromBodyElement(bodyEl) {
  const panel = bodyEl?.closest?.('.cat-panel');
  if (!panel) return null;
  const idx = parseInt(panel.dataset.catIdx, 10);
  if (Number.isNaN(idx) || idx < 0 || idx >= CATS.length) return null;
  return CATS[idx];
}

function clearItemReorderHighlights() {
  document.querySelectorAll('.item.drag-above,.item.drag-below').forEach(el => {
    el.classList.remove('drag-above', 'drag-below');
  });
  document.querySelectorAll('.cp-body.body-drop-over').forEach(el => {
    el.classList.remove('body-drop-over');
  });
}

let _ptrItemReorder = null;

function isHiddenCatLayoutNode(el) {
  if (!el) return true;
  const pool = document.getElementById('widgetAnchorPool');
  const templates = document.getElementById('widgetAnchorTemplates');
  if (pool?.contains(el) || templates?.contains(el)) return true;
  const catZone = document.getElementById('catZone');
  if (catZone?.contains(el) && !catZone.closest('.widget-cell')) return true;
  return false;
}

function queryActiveCatItems() {
  return [...document.querySelectorAll('.cat-panel .cp-body .item')]
    .filter((it) => !isHiddenCatLayoutNode(it));
}

function queryActiveCatBodies() {
  return [...document.querySelectorAll('.cat-panel .cp-body')]
    .filter((body) => !isHiddenCatLayoutNode(body.closest('.cat-panel')));
}

function catFromPanelElement(panel) {
  if (!panel) return null;
  const idx = parseInt(panel.dataset.catIdx, 10);
  if (Number.isNaN(idx) || idx < 0 || idx >= CATS.length) return null;
  return CATS[idx];
}

function isLocalFolderItem(item) {
  if (!item?.path) return false;
  if (item.tag === '폴더' || item.ic === '📁') return true;
  const p = String(item.path);
  return p.endsWith('/') || p.endsWith('\\') || !String(p.split(/[\\/]/).pop() || '').includes('.');
}

/** Google 파일 드래그 드롭 대상 (WebView2: rect 히트) */
function findGoogleFileDropTarget(clientX, clientY) {
  for (const row of queryActiveCatItems()) {
    const r = row.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      const item = row.__itemRef;
      const cat = row.__catRef;
      if (item && cat && isLocalFolderItem(item)) {
        return { kind: 'folder', row, cat, item };
      }
      const body = row.closest('.cp-body');
      if (body && cat) return { kind: 'body', bodyEl: body, cat };
    }
  }

  for (const dz of document.querySelectorAll('.cat-panel .cp-drop')) {
    const panel = dz.closest('.cat-panel');
    if (!panel || isHiddenCatLayoutNode(panel)) continue;
    const r = dz.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      const cat = catFromPanelElement(panel);
      if (cat) return { kind: 'dropzone', dz, cat };
    }
  }

  for (const body of queryActiveCatBodies()) {
    const r = body.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      const cat = catFromBodyElement(body);
      if (cat) return { kind: 'body', bodyEl: body, cat };
    }
  }
  return null;
}

/** WebView2: elementFromPoint 대신 좌표·getBoundingClientRect 히트 (설정 패널 DnD와 동일) */
function findItemDropTarget(clientX, clientY, srcRow) {
  for (const it of queryActiveCatItems()) {
    if (it === srcRow || !it.__catRef || !it.__itemRef) continue;
    const r = it.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      const above = clientY < r.top + r.height / 2;
      return { kind: 'item', targetRow: it, insertAbove: above };
    }
  }

  for (const body of queryActiveCatBodies()) {
    const r = body.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      const dstCat = catFromBodyElement(body);
      if (dstCat) return { kind: 'body', dropCat: dstCat, bodyEl: body };
    }
  }
  return null;
}

function updateItemPointerDropTarget(clientX, clientY, srcRow) {
  if (!_ptrItemReorder) return;
  clearItemReorderHighlights();
  _ptrItemReorder.targetRow = null;
  _ptrItemReorder.dropCat = null;

  const hit = findItemDropTarget(clientX, clientY, srcRow);
  if (!hit) return;

  if (hit.kind === 'item') {
    hit.targetRow.classList.toggle('drag-above', hit.insertAbove);
    hit.targetRow.classList.toggle('drag-below', !hit.insertAbove);
    _ptrItemReorder.targetRow = hit.targetRow;
    _ptrItemReorder.insertAbove = hit.insertAbove;
    return;
  }

  if (hit.kind === 'body') {
    hit.bodyEl.classList.add('body-drop-over');
    _ptrItemReorder.dropCat = hit.dropCat;
  }
}

function commitItemPointerReorder() {
  const pr = _ptrItemReorder;
  _ptrItemReorder = null;
  if (!pr?.moved) return false;

  let ok = false;
  if (pr.targetRow) {
    ok = reorderCatItem(
      pr.srcCat, pr.srcItem,
      pr.targetRow.__catRef, pr.targetRow.__itemRef,
      pr.insertAbove
    );
  } else if (pr.dropCat) {
    ok = moveItemToCatEnd(pr.srcCat, pr.srcItem, pr.dropCat);
  }
  if (ok) void refreshCategoryUi();
  return ok;
}

let _itemReorderDidMove = false;

/** Tauri WebView2: pointer capture + rect 히트로 순서·카테고리 이동 (행 전체 또는 ⋮⋮) */
function beginItemReorder(row, cat, item, startEvent) {
  if (_ptrItemReorder || _ptrGoogleFileDrag) return;
  const pid = startEvent.pointerId ?? 1;
  const sx = startEvent.clientX;
  const sy = startEvent.clientY;
  let moved = false;
  let ghost = null;
  _itemReorderDidMove = false;

  const captureEl = row;
  try { captureEl.setPointerCapture(pid); } catch (_) {}

  _ptrItemReorder = {
    srcCat: cat,
    srcItem: item,
    row,
    targetRow: null,
    dropCat: null,
    insertAbove: true,
    moved: false,
  };

  const onMove = ev => {
    if (ev.pointerId !== pid || !_ptrItemReorder) return;
    if (!moved) {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 6) return;
      moved = true;
      _itemReorderDidMove = true;
      _ptrItemReorder.moved = true;
      ev.preventDefault();
      row.classList.add('item-ptr-dragging');
      document.body.classList.add('item-reorder-active');
      ghost = document.createElement('div');
      ghost.className = 'item-drag-ghost';
      ghost.textContent = item.lbl || '항목';
      ghost.style.left = (ev.clientX + 12) + 'px';
      ghost.style.top = (ev.clientY + 10) + 'px';
      document.body.appendChild(ghost);
    }
    if (ghost) {
      ghost.style.left = (ev.clientX + 12) + 'px';
      ghost.style.top = (ev.clientY + 10) + 'px';
    }
    updateItemPointerDropTarget(ev.clientX, ev.clientY, row);
  };

  const endDrag = ev => {
    if (ev.pointerId !== pid) return;
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', endDrag, true);
    document.removeEventListener('pointercancel', endDrag, true);
    try { captureEl.releasePointerCapture(pid); } catch (_) {}
    if (ghost) { ghost.remove(); ghost = null; }
    row.classList.remove('item-ptr-dragging');
    document.body.classList.remove('item-reorder-active');
    clearItemReorderHighlights();
    if (_ptrItemReorder) _ptrItemReorder.moved = moved;
    commitItemPointerReorder();
  };

  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', endDrag, true);
  document.addEventListener('pointercancel', endDrag, true);
}

function installItemRowInteractions(row, cat, item) {
  row.__catRef = cat;
  row.__itemRef = item;
  row.draggable = false;
  const openHint = item.path ? ' — 클릭하여 열기' : '';
  row.title = (item.lbl || '') + openHint + ' · 잡고 끌어 순서·카테고리 이동';

  row.addEventListener('click', async e => {
    if (_itemReorderDidMove) {
      _itemReorderDidMove = false;
      return;
    }
    if (!item.path) { showToast('❌ 경로가 없어요. 항목을 다시 드래그해서 추가해 주세요.'); return; }
    const r = await openItemPath(item);
    if (r?.error) showToast('❌ 열기 실패: ' + String(r.error).slice(0, 80));
  });

  const lblEl = row.querySelector('.item-lbl');
  if (lblEl) {
    lblEl.addEventListener('dblclick', e => {
      e.preventDefault();
      e.stopPropagation();
      _ctxCat = cat;
      _ctxItem = item;
      showRenamePopup(e.clientX, e.clientY);
    });
  }

  row.addEventListener('pointerdown', e => {
    if (e.button !== 0 || _ptrGoogleFileDrag) return;
    if (e.target.closest('.item-lbl') && e.detail > 1) return;
    e.stopPropagation();
    beginItemReorder(row, cat, item, e);
  });
}

/* ── plugin-process: 앱 완전 종료 (트레이 메뉴 "종료"에서 호출) ── */
function quitApp() { tInvoke('plugin:process|exit', { code: 0 }).catch(() => {}); }

/* ── 창 트레이로 숨기기 (바탕화면 보기) ── */
async function hideToTray() {
  try { await window.__TAURI__.window.getCurrentWindow().hide(); }
  catch (e) { console.error('[hideToTray]', e); }
}

async function showDesktopPeek() {
  const first = !localStorage.getItem('desktopPeekHintSeen');
  await hideToTray();
  showToast(
    first
      ? '바탕화면이 보여요. 파일을 옮긴 뒤 작업 표시줄 트레이의 대시보드 아이콘을 누르면 다시 열려요.'
      : '트레이 아이콘을 누르면 대시보드가 다시 열려요.',
    first ? 6500 : 3200,
  );
  if (first) localStorage.setItem('desktopPeekHintSeen', '1');
}

/* ── plugin-dialog: 폴더 선택 다이얼로그 ── */
async function selectDownloadFolder() {
  try {
    const picked = await tDialogOpen({ multiple: false, directory: true, title: '다운로드 폴더 선택' });
    if (!picked) return null;
    return Array.isArray(picked) ? picked[0] : picked;
  } catch { return null; }
}

/* ── Electron 호환 심 — 파일 경로 / stat ── */
function getFilePath(f) { return f?.path || ''; }
async function statPath(p) {
  if (!p) return { isDir: false };
  try {
    const info = await tInvoke('plugin:fs|stat', { path: p });
    if (info && typeof info.isDirectory === 'boolean') return { isDir: info.isDirectory };
  } catch {}
  const name = String(p).split(/[\\/]/).pop();
  return { isDir: !name.includes('.') || p.endsWith('\\') || p.endsWith('/') };
}

/* ── 창 포커스 (알람 팝업 등에서 호출) ─────────────────────────
 * 숨겨져 있으면 표시 → 현재 모니터 workArea 로 스냅 → 임시 최상단
 * ────────────────────────────────────────────────────────────── */
async function focusWindow() {
  try {
    const w = window.__TAURI__.window.getCurrentWindow();
    await w.show();
    await w.setAlwaysOnTop(true);
    await w.setFocus();
    // 스냅 (비동기 - 포커스 애니메이션 방해 없도록 살짝 지연)
    setTimeout(() => snapToCurrentMonitor().catch(() => {}), 100);
    setTimeout(() => w.setAlwaysOnTop(false).catch(() => {}), 5000);
  } catch (e) { console.error('[focusWindow]', e); }
}

/* ── plugin-autostart ── */
async function getLoginItem() {
  try   { return { openAtLogin: await tInvoke('plugin:autostart|is_enabled') }; }
  catch { return { openAtLogin: false }; }
}
async function setLoginItem(enabled) {
  try   { await tInvoke(enabled ? 'plugin:autostart|enable' : 'plugin:autostart|disable'); }
  catch (e) { console.error('[setLoginItem]', e); }
}

/* ── plugin-app: 앱 버전 ── */
async function getAppVersion() {
  try { return await tInvoke('plugin:app|version'); } catch { return ''; }
}

const UPDATE_ATTEMPT_KEY = 'dashboardLastUpdateAttempt';
const UPDATE_ATTEMPT_AT_KEY = 'dashboardLastUpdateAttemptAt';
const UPDATE_LOOP_COOLDOWN_MS = 60 * 60 * 1000;

function parseVersionParts(v) {
  return String(v || '0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
}

function compareVersions(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function normalizeVersionLabel(v) {
  return String(v || '').replace(/^v/i, '').trim();
}

/* ── 인증 상태 확인 (keyring + access_token 유효성) ── */
async function getAuthStatus() {
  try {
    const token = await getValidAccessToken();
    return { authenticated: !!token };
  } catch (e) {
    console.warn('[Auth] getAuthStatus:', e);
    return { authenticated: false };
  }
}

/* ── Google 연결 해제 ── */
async function googleDisconnect() { await clearTokens(); }

/* ── onAuthUpdate 콜백 (설정 패널 상태 로그) ── */
let _authUpdateCallback = null;
function onAuthUpdate(cb)     { _authUpdateCallback = cb; }
function _emitAuthUpdate(msg) { if (_authUpdateCallback) _authUpdateCallback(msg); }

/* ── Google 인증 시작 (OAuth 2.0 Desktop Flow) ──
 *  1. invoke('start_oauth') → Rust 서버 바인딩 (port 59123)
 *  2. tListen('auth-code') 등록 후 브라우저 열기 (race condition 방지)
 *  3. 코드 수신 → exchangeCodeForTokens() → 토큰 저장
 */
async function googleAuthStart() {
  try {
    _emitAuthUpdate('🔑 브라우저 열기 중...');
    await tInvoke('start_oauth');

    return await new Promise(async (resolve) => {
      let done = false;
      const unlisteners = [];
      const cleanup = () => {
        if (!done) { done = true; unlisteners.forEach(u => { try { u(); } catch {} }); }
      };

      unlisteners.push(await tListen('auth-code', async (evt) => {
        if (done) return; cleanup();
        _emitAuthUpdate('🔄 인증 코드 수신 — 토큰 교환 중...');
        const r = await exchangeCodeForTokens(evt.payload);
        if (r.success) {
          _emitAuthUpdate('✅ 토큰 저장 완료 — 연결 성공!');
          resolve({ success: true });
        } else {
          _emitAuthUpdate('❌ 토큰 교환 실패: ' + r.error);
          resolve({ success: false, error: r.error });
        }
      }));
      unlisteners.push(await tListen('auth-code-error', (evt) => {
        if (done) return; cleanup();
        _emitAuthUpdate('❌ 인증 오류: ' + evt.payload);
        resolve({ success: false, error: evt.payload });
      }));

      // 리스너 등록 완료 후 브라우저 열기
      await openPath(getAuthUrl());
      _emitAuthUpdate('🌐 브라우저에서 Google 계정을 선택해 주세요...');
    });
  } catch (err) {
    _emitAuthUpdate('❌ 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/* ── onUpdateStatus 콜백 (업데이트 배너 / 설정 패널) ── */
/* ════════════════════════════════════════════════════════════════
   자동 업데이트 — 7단계 완전 구현
   plugin:updater|check → download(Channel 진행률) → install(재시작)
   흐름:
     checkForUpdates()          → check → available
     _startDownloadProgress()   → download(onEvent) → progress* → downloaded
     installUpdate()            → install → 앱 재시작
   ※ pubkey: "" 상태(Stage 8 이전)에서는 에러 발생 → 조용히 처리
════════════════════════════════════════════════════════════════ */

let _updateStatusCallback = null;
let _pendingUpdateRid     = null;   // plugin:updater|check 에서 받은 update RID
let _downloadedBytesRid   = null;   // plugin:updater|download 에서 받은 bytes RID
let _pendingUpdateVersion = '';
let _updateInstallTimer   = null;
let _updateInstallStarted = false;

function mapDownloadOverlayPercent(raw) {
  return Math.max(4, Math.min(82, Math.round(raw * 0.82)));
}

function setUpdateOverlayProgress(percent, sub) {
  const overlay = document.getElementById('updateOverlay');
  const fill = document.getElementById('uoProgressFill');
  const pctEl = document.getElementById('uoPercent');
  const subEl = document.getElementById('uoSub');
  const bar = document.getElementById('uoProgressBar');
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  if (overlay) overlay.classList.add('uo-show');
  if (fill) fill.style.width = `${pct}%`;
  if (pctEl) pctEl.textContent = `${pct}%`;
  if (subEl && sub) subEl.textContent = sub;
  if (bar) {
    bar.setAttribute('aria-valuenow', String(pct));
    bar.setAttribute('aria-valuetext', `${pct}%`);
  }
  document.getElementById('updateBanner')?.classList.remove('ub-show');
}

function hideUpdateOverlay() {
  if (_updateInstallTimer) {
    clearInterval(_updateInstallTimer);
    _updateInstallTimer = null;
  }
  document.getElementById('updateOverlay')?.classList.remove('uo-show');
}

function beginInstallUpdate() {
  if (_updateInstallStarted || _pendingUpdateRid === null) return;
  _updateInstallStarted = true;
  _ubState = 'installing';
  setUpdateOverlayProgress(84, '새 버전을 적용하고 있어요');
  let p = 84;
  _updateInstallTimer = setInterval(() => {
    p = Math.min(98, p + 2);
    setUpdateOverlayProgress(p, '새 버전을 적용하고 있어요');
    if (p >= 98) {
      clearInterval(_updateInstallTimer);
      _updateInstallTimer = null;
      setUpdateOverlayProgress(100, '곧 다시 시작돼요');
      setTimeout(() => { void installUpdate(); }, 280);
    }
  }, 110);
}

function onUpdateStatus(cb)      { _updateStatusCallback = cb; }
function _emitUpdateStatus(info) { if (_updateStatusCallback) _updateStatusCallback(info); }

/**
 * 업데이트 확인.
 * 새 버전이 있으면 자동으로 백그라운드 다운로드를 시작한다.
 * pubkey 미설정·네트워크 오류는 개발 단계 정상 상황으로 조용히 처리.
 */
async function checkForUpdates() {
  try {
    const currentVersion = normalizeVersionLabel(await getAppVersion());
    const metadata = await tInvoke('plugin:updater|check', {});

    if (!metadata) {
      if (currentVersion) localStorage.removeItem(UPDATE_ATTEMPT_KEY);
      _emitUpdateStatus({ type: 'not-available' });
      return;
    }

    const targetVersion = normalizeVersionLabel(metadata.version);
    if (currentVersion && targetVersion && compareVersions(currentVersion, targetVersion) >= 0) {
      localStorage.removeItem(UPDATE_ATTEMPT_KEY);
      _emitUpdateStatus({ type: 'not-available' });
      return;
    }

    const lastAttempt = localStorage.getItem(UPDATE_ATTEMPT_KEY);
    const lastAttemptAt = Number(localStorage.getItem(UPDATE_ATTEMPT_AT_KEY) || 0);
    const inLoopCooldown = lastAttemptAt > 0 && (Date.now() - lastAttemptAt) < UPDATE_LOOP_COOLDOWN_MS;
    if (
      currentVersion && targetVersion && lastAttempt === targetVersion
      && compareVersions(currentVersion, targetVersion) < 0
      && inLoopCooldown
    ) {
      const retryMin = Math.max(1, Math.ceil((UPDATE_LOOP_COOLDOWN_MS - (Date.now() - lastAttemptAt)) / 60000));
      _emitUpdateStatus({
        type: 'error',
        code: 'update-loop',
        message: `v${targetVersion} 설치가 완료되지 않았어요(현재 v${currentVersion}). ${retryMin}분 후 자동으로 다시 시도합니다.`,
      });
      return;
    }
    if (lastAttempt === targetVersion && !inLoopCooldown) {
      localStorage.removeItem(UPDATE_ATTEMPT_KEY);
      localStorage.removeItem(UPDATE_ATTEMPT_AT_KEY);
    }

    _pendingUpdateRid     = metadata.rid   ?? null;
    _downloadedBytesRid   = null;
    _pendingUpdateVersion = metadata.version || '';
    _updateInstallStarted = false;

    _emitUpdateStatus({ type: 'available', version: _pendingUpdateVersion || '?' });

    // 발견 즉시 백그라운드 다운로드 시작
    _startDownloadProgress(metadata).catch(e => {
      console.warn('[Updater] 다운로드 실패:', e);
      localStorage.removeItem(UPDATE_ATTEMPT_KEY);
      localStorage.removeItem(UPDATE_ATTEMPT_AT_KEY);
      const msg = String(e.message || e);
      const hint = /github\.com|403|404|blocked|fetch|network|timeout/i.test(msg)
        ? ' 설치 파일 CDN(jsdelivr) 접속을 확인해 주세요.'
        : '';
      _emitUpdateStatus({ type: 'error', message: (msg || '다운로드 실패') + hint });
    });

  } catch (e) {
    const msg = String(e.message ?? e);
    if (/valid release JSON|404|not found|could not fetch/i.test(msg)) {
      _emitUpdateStatus({
        type: 'error',
        message: '업데이트 정보(latest.json)를 받지 못했어요. GitHub 릴리즈에 latest.json·서명(.sig)이 있는지 확인해 주세요.',
      });
    } else if (/different key|created with a different key/i.test(msg)) {
      _emitUpdateStatus({
        type: 'error',
        code: 'key-rotation',
        message: 'v2.1.0 이하 버전은 서명 키가 바뀌어 앱 내 자동 업데이트를 사용할 수 없어요. GitHub에서 v2.1.2 이상을 한 번 직접 설치하면 이후부터는 자동 업데이트가 됩니다.',
      });
    } else if (/pubkey|signature|CERTIFICATE|verify/i.test(msg)) {
      _emitUpdateStatus({
        type: 'error',
        message: '다운로드 서명 검증에 실패했어요. 설치 파일(.exe)에 맞는 .sig 서명이 GitHub 릴리즈에 올라갔는지 확인해 주세요.',
      });
    } else if (/missing field|No data|notFound/i.test(msg)) {
      console.info('[Updater] 릴리즈 메타데이터 없음:', msg);
      _emitUpdateStatus({ type: 'not-available' });
    } else if (/dashboard-state\.json/i.test(msg)) {
      console.warn('[Updater] state file conflict during check:', msg);
      _emitUpdateStatus({
        type: 'error',
        message: '대시보드 설정 저장 충돌이 감지됐어요. v3.3.3 이상으로 업데이트하면 해결됩니다. 잠시 후 다시 시도해 주세요.',
      });
    } else {
      _emitUpdateStatus({ type: 'error', message: msg });
    }
  }
}

/**
 * 업데이트 패키지를 다운로드한다.
 * Channel 을 사용하여 진행률(Started → Progress* → Finished)을 수신한다.
 * Finished 이벤트에서 downloadedBytesRid 를 저장하고 'downloaded' 상태를 emit.
 */
async function _startDownloadProgress(metadata) {
  const Channel  = window.__TAURI__.core.Channel;
  const channel  = new Channel();
  let totalBytes  = 0;
  let loadedBytes = 0;

  channel.onmessage = (msg) => {
    switch (msg.event) {
      case 'Started':
        totalBytes  = msg.data?.contentLength || 0;
        loadedBytes = 0;
        _emitUpdateStatus({ type: 'progress', percent: 0, version: metadata.version, phase: 'download' });
        break;

      case 'Progress':
        loadedBytes += msg.data?.chunkLength || 0;
        const rawPct = totalBytes > 0
          ? Math.round(Math.min((loadedBytes / totalBytes) * 100, 99))
          : 0;
        _emitUpdateStatus({
          type: 'progress',
          percent: rawPct,
          overlayPercent: mapDownloadOverlayPercent(rawPct),
          version: metadata.version,
          phase: 'download',
        });
        break;

      case 'Finished':
        _emitUpdateStatus({
          type: 'downloaded',
          version: metadata.version,
          overlayPercent: 82,
          phase: 'install',
        });
        break;
    }
  };

  // 다운로드 실행 → 완료 시 downloadedBytesRid 반환
  const bytesRid = await tInvoke('plugin:updater|download', {
    onEvent: channel,
    rid:     metadata.rid,
  });
  _downloadedBytesRid = bytesRid ?? null;
}

/**
 * 다운로드된 업데이트를 설치하고 앱을 재시작한다.
 * 배너의 "지금 재시작하여 업데이트" 버튼에서 호출됨.
 */
async function installUpdate() {
  if (_pendingUpdateRid === null) {
    console.warn('[Updater] 설치할 업데이트 없음');
    hideUpdateOverlay();
    return;
  }
  try {
    if (_widgetGridState) {
      try { await flushSaveState(_widgetGridState); } catch (e) {
        console.warn('[Updater] state flush before install (continuing):', e);
      }
    }
    const targetVersion = normalizeVersionLabel(_pendingUpdateVersion);
    if (targetVersion) {
      localStorage.setItem(UPDATE_ATTEMPT_KEY, targetVersion);
      localStorage.setItem(UPDATE_ATTEMPT_AT_KEY, String(Date.now()));
    }
    setUpdateOverlayProgress(100, '업데이트를 마무리하고 있어요');
    if (_downloadedBytesRid !== null) {
      await tInvoke('plugin:updater|install', {
        updateRid: _pendingUpdateRid,
        bytesRid:  _downloadedBytesRid,
      });
    } else {
      const Channel = window.__TAURI__.core.Channel;
      const ch = new Channel();
      await tInvoke('plugin:updater|download_and_install', {
        onEvent: ch,
        rid:     _pendingUpdateRid,
      });
    }
    // quiet + /R 모드: NSIS가 앱을 재시작함. 미재시작 시에만 폴백.
    await tInvoke('plugin:process|restart').catch(() => {});
  } catch (e) {
    console.error('[installUpdate]', e);
    localStorage.removeItem(UPDATE_ATTEMPT_KEY);
    localStorage.removeItem(UPDATE_ATTEMPT_AT_KEY);
    hideUpdateOverlay();
    _updateInstallStarted = false;
    _emitUpdateStatus({ type: 'error', message: e.message || String(e) });
  }
}

/* 앱 시작 3초 후 자동 업데이트 확인 (백그라운드 — UI 로딩 방해 없음) */
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    checkForUpdates().catch(e => console.warn('[Updater/startup]', e));
  }, 3000);
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      void showDesktopPeek();
    }
  });
}, { once: true });

/* 창 제어 → js/window-control.js 로 분리됨 */

/* 앱 시작 시 토큰 마이그레이션 상태 확인 */
checkMigration().then(s => console.info('[TokenStore/Migration]', s));

/* ══════════════════════════════════════════
   배율 시스템 — scale() 금지, CSS 변수 기반
   window.innerHeight = 작업표시줄 제외 실제 가용 높이
   배율 변경 시 레이아웃 전체 재계산
══════════════════════════════════════════ */
let userScale = parseInt(localStorage.getItem('appScale') || '100') || 100;

/* 실제 가용 영역 계산 (작업표시줄 자동 제외) */
function getViewport(){
  // window.innerWidth/Height 는 브라우저 뷰포트 = 작업표시줄 제외 영역
  // screen.availHeight 는 OS 작업표시줄 제외 화면 높이
  const vw = window.innerWidth;
  const vh = window.innerHeight; // 작업표시줄 제외
  return { vw, vh };
}

/* 핵심: scale() 대신 CSS --base-size 변수로 폰트·간격 조절 */
function applyLayoutScale(){
  const { vw, vh } = getViewport();
  const wrap = document.getElementById('screenWrap');
  if (!wrap) return;

  // 1) 화면 전체를 가용 영역에 맞게 핏 (잘림 없음)
  //    screen-wrap 자체는 항상 뷰포트 100% 채우게
  wrap.style.width  = vw + 'px';
  wrap.style.height = vh + 'px';
  wrap.style.transform = 'none'; // scale() 제거

  // 2) 배율은 CSS custom property 로 전달 → 폰트·패딩에만 적용
  const ratio = userScale / 100;
  document.documentElement.style.setProperty('--scale', ratio);
  document.documentElement.style.setProperty('--fs-base',  (12 * ratio) + 'px');
  document.documentElement.style.setProperty('--fs-sm',    (11 * ratio) + 'px');
  document.documentElement.style.setProperty('--fs-xs',    (10 * ratio) + 'px');
  document.documentElement.style.setProperty('--fs-md',    (13.5 * ratio) + 'px');
  document.documentElement.style.setProperty('--fs-lg',    (16 * ratio) + 'px');
  document.documentElement.style.setProperty('--pad-card', (10 * ratio) + 'px');
  document.documentElement.style.setProperty('--gap-layout',(9 * ratio) + 'px');
  document.documentElement.style.setProperty('--side-w',   Math.round(280 * ratio) + 'px');
  document.documentElement.style.setProperty('--topbar-h', Math.round(48 * ratio) + 'px');
  document.documentElement.style.setProperty('--r-card',   Math.round(18 * ratio) + 'px');

  // 3) 힌트 업데이트
  const hint = document.getElementById('scaleVal');
  if(hint) hint.textContent = userScale + '%  |  ' + vw + '×' + vh + ' (작업표시줄 제외)';

  document.body.style.overflow = 'hidden';
}

/* CSS 변수를 실제 선택자에 반영 (font-size 일괄 적용) */
function injectScaleStyle(){
  let el = document.getElementById('_scaleStyle');
  if(!el){ el=document.createElement('style'); el.id='_scaleStyle'; document.head.appendChild(el); }
  const r = userScale/100;
  el.textContent = `
    .topbar          { height: ${Math.round(48*r)}px !important; padding: 0 ${Math.round(20*r)}px !important; }
    .tb-logo         { font-size: ${Math.round(18*r)}px !important; }
    .tb-date         { font-size: ${Math.round(18*r)}px !important; }
    .tb-menu-google  { font-size: ${Math.round(11*r)}px !important; padding: ${Math.round(8*r)}px ${Math.round(10*r)}px ${Math.round(6*r)}px !important; }
    .tb-user-avatar-wrap { width: ${Math.round(26*r)}px !important; height: ${Math.round(26*r)}px !important; }
    .tb-btn          { width:${Math.round(34*r)}px !important; height:${Math.round(34*r)}px !important; font-size:${Math.round(14*r)}px !important; }
    .gc              { border-radius: ${Math.round(20*r)}px !important; }
    .ch              { padding: ${Math.round(11*r)}px ${Math.round(14*r)}px ${Math.round(9*r)}px !important; }
    .ch-icon         { font-size: ${Math.round(15*r)}px !important; }
    .ch-title        { font-size: ${Math.round(12.5*r)}px !important; }
    .nb              { font-size: ${Math.round(12*r)}px !important; padding: ${Math.round(3*r)}px ${Math.round(8*r)}px !important; border-radius:${Math.round(7*r)}px !important; }
    .cal-dow         { font-size: ${Math.round(10*r)}px !important; }
    .cday            { font-size: ${Math.round(12*r)}px !important; padding: ${Math.round(5*r)}px 2px !important; border-radius:${Math.round(7*r)}px !important; }
    .cev             { font-size: ${Math.round(11.5*r)}px !important; padding: ${Math.round(4*r)}px ${Math.round(8*r)}px !important; }
    .cev-time        { font-size: ${Math.round(10*r)}px !important; }
    .cal-add-btn     { font-size: ${Math.round(11*r)}px !important; padding: ${Math.round(6*r)}px !important; border-radius:${Math.round(9*r)}px !important; }
    .img-mock        { font-size: ${Math.round(13*r)}px !important; min-height:${Math.round(140*r)}px !important; }
    .cat-zone        { gap: ${Math.round(9*r)}px !important; padding: ${Math.round(10*r)}px ${Math.round(12*r)}px ${Math.round(10*r)}px ${Math.round(8*r)}px !important; }
    .cat-panel       { border-radius: ${Math.round(20*r)}px !important; }
    .cp-head         { padding: ${Math.round(12*r)}px ${Math.round(12*r)}px ${Math.round(8*r)}px !important; gap:${Math.round(8*r)}px !important; }
    .cp-icon         { width:${Math.round(34*r)}px !important; height:${Math.round(34*r)}px !important; font-size:${Math.round(17*r)}px !important; border-radius:${Math.round(10*r)}px !important; }
    .cp-name         { font-size: ${Math.round(13*r)}px !important; }
    .cp-sub          { font-size: ${Math.round(9.5*r)}px !important; }
    .item            { padding: ${Math.round(6*r)}px ${Math.round(8*r)}px !important; border-radius:${Math.round(10*r)}px !important; }
    .item-ico        { font-size: ${Math.round(13*r)}px !important; }
    .item-lbl        { font-size: ${Math.round(11.5*r)}px !important; }
    .item-tag        { font-size: ${Math.round(9.5*r)}px !important; padding: ${Math.round(2*r)}px ${Math.round(6*r)}px !important; }
    .cp-drop         { font-size: ${Math.round(10.5*r)}px !important; padding: ${Math.round(8*r)}px !important; border-radius:${Math.round(10*r)}px !important; }
    .cp-dbtn         { font-size: ${Math.round(10.5*r)}px !important; padding: ${Math.round(5*r)}px 0 !important; border-radius:${Math.round(8*r)}px !important; }
    .note-tag        { font-size: ${Math.round(11*r)}px !important; padding: ${Math.round(3*r)}px ${Math.round(8*r)}px !important; border-radius:999px !important; }
    .note-input      { font-size: ${Math.round(11.5*r)}px !important; }
    .note-add-btn    { width:${Math.round(22*r)}px !important; height:${Math.round(22*r)}px !important; font-size:${Math.round(14*r)}px !important; border-radius:${Math.round(7*r)}px !important; }
    .cp-note-area    { border-radius: ${Math.round(12*r)}px !important; margin: 0 ${Math.round(8*r)}px ${Math.round(8*r)}px !important; }
  `;
}

function scaleScreen(){ applyLayoutScale(); injectScaleStyle(); }
window.addEventListener('resize', scaleScreen);

/* 배율 적용 + UI 동기화 */
function applyScale(val){
  userScale = Math.max(70, Math.min(150, val));
  scaleScreen();
  const pct = (userScale-70)/(150-70)*100;
  ['scaleSetupSlider','sfSlider'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){ el.value=userScale; el.style.setProperty('--pct', pct+'%'); }
  });
  const badge=document.getElementById('scaleSetupBadge'); if(badge) badge.textContent=userScale+'%';
  const sfv=document.getElementById('sfVal');             if(sfv)   sfv.textContent=userScale+'%';
  const tbsv=document.getElementById('tbScaleVal');        if(tbsv)  tbsv.textContent=userScale+'%';
  const pvl=document.getElementById('previewLabel');      if(pvl)   pvl.textContent=userScale+'%';
  const pw = 44 + (userScale-70)/(150-70)*40;
  const ps=document.getElementById('previewScreen');
  if(ps){ ps.style.width=pw+'px'; ps.style.height=(pw*0.625)+'px'; }
  document.querySelectorAll('.scale-preset').forEach(el=>{
    const v=parseInt(el.textContent); el.classList.toggle('sel', v===userScale);
  });
  const descs={
    70:['작게','더 많은 정보를 한 화면에 볼 수 있어요'],
    80:['약간 작게','정보 밀도를 높일 때 추천'],
    85:['조금 작게','WQHD 고밀도 작업에 최적'],
    90:['조금 작게','기본과 작게의 중간'],
    95:['거의 기본','기본보다 살짝 작아요'],
    100:['기본 크기','WQHD 환경 최적화 기본 배율'],
    105:['기본+','살짝 더 크게'],
    110:['조금 크게','글자 가독성 향상'],
    115:['조금 크게','눈이 편안해지는 크기'],
    120:['크게','명확한 가독성'],
    130:['크게','여유있는 레이아웃'],
    140:['매우 크게','텍스트 중심 작업 추천'],
    150:['최대 크기','시각 보조가 필요할 때'],
  };
  const desc=descs[userScale]||['사용자 정의','직접 설정한 배율'];
  const pt=document.getElementById('previewTitle');  if(pt)  pt.textContent=desc[0];
  const ps2=document.getElementById('previewSub');   if(ps2) ps2.textContent=desc[1];
}

function onSetupSliderInput(val){ applyScale(parseInt(val)); }
function onSfSlider(val){ applyScale(parseInt(val)); }
function adjustScale(delta){ applyScale(userScale+delta); }
function setScalePreset(val){ applyScale(val); }

/* 플로팅 배율 패널 토글 */
let sfOpen=false;
function toggleScaleFloater(){
  sfOpen=!sfOpen;
  const f=document.getElementById('scaleFloater');
  f.style.display=sfOpen?'flex':'none';
  if(sfOpen) applyScale(userScale);
}
document.addEventListener('click', e=>{
  if(sfOpen && !e.target.closest('#scaleFloater') && !e.target.closest('#btnScaleToggle')){
    sfOpen=false; document.getElementById('scaleFloater').style.display='none';
  }
});

/* ── Setup 스텝 ── */
let setupStep = 0;
function updateSetup(){
  ['sp0','sp1','sp2'].forEach((id,i)=>{
    document.getElementById(id).classList.toggle('active', i===setupStep);
  });
  ['sd0','sd1','sd2'].forEach((id,i)=>{
    const el=document.getElementById(id);
    el.className='sdot '+(i<setupStep?'done':i===setupStep?'active':'')+ ' idle';
  });
  document.getElementById('btnBack').style.display = setupStep>0?'flex':'none';
  document.getElementById('btnNext').textContent = setupStep===2?'✨ 시작하기':'다음 →';
}
function nextSetupStep(){
  if(setupStep<2){
    setupStep++; updateSetup();
    // Step 1 진입 시 기존 연결 상태 자동 확인
    if(setupStep === 1) checkSetupAuthStatus();
  }
  else { launchDashboard(); }
}
function prevSetupStep(){
  if(setupStep>0){ setupStep--; updateSetup(); }
}
function selRes(el){ document.querySelectorAll('.res-card').forEach(e=>e.classList.remove('sel')); el.classList.add('sel'); }
function selCat(el){ document.querySelectorAll('.cnum').forEach(e=>e.classList.remove('sel')); el.classList.add('sel'); }
/* reopenSetup → 초기 설정이 아닌 설정 모달 오픈 */
function reopenSetup(){
  openSettings();
}

/* ══════════════════════════════════════════════
   설정 모달 — 열기/닫기/탭/적용
══════════════════════════════════════════════ */

// 무지개 파스텔 7색 팔레트
const RAINBOW_COLORS = [
  '#ffb3b3','#ffc998','#ffe08a','#a7f3c0','#93c5fd','#a5b4fc','#d8b4fe',
  '#ff8fab','#ffcba4','#fff3b0','#c7f2a4','#bfdbfe','#c7d2fe','#ede9fe',
  '#fda4af','#fdba74','#fde68a','#6ee7b7','#60a5fa','#818cf8','#c4b5fd',
];

// 편집용 임시 카테고리 목록 (설정 열 때 복사)
let spCats = [];
let spScale = 100;
let activePaletteCatIdx = -1;

const SP_WIDGET_TYPE_LABELS = {
  calendar: '캘린더', drive: 'Weekly Plan', todo: '메모 · 할 일',
  gsheets: 'Google Sheets', gslides: 'Google Slides', gdocs: 'Google Docs',
  category: '카테고리',
  clock: '시계', sticky: '스티키 메모', pomodoro: '뽀모도로', dday: 'D-Day',
  weather: '날씨', gemini: 'Gemini',
};
const SP_WIDGET_TYPE_ICONS = {
  calendar: '📅', drive: '📁', todo: '✅',
  gsheets: '📊', gslides: '📽', gdocs: '📄',
  category: '📚', clock: '🕐', sticky: '📝',
  pomodoro: '🍅', dday: '📆', weather: '🌤', gemini: '🤖',
};

/* Google Workspace 브랜드 아이콘 (2024~2025 앱 런처 기준) */
const GDRIVE_ICON_MARKER = '__gdrive__';
const GCAL_ICON_MARKER = '__gcal__';
const GTASK_ICON_MARKER = '__gtask__';
const GEMINI_ICON_MARKER = '__gemini__';
const GSHEETS_ICON_MARKER = '__gsheets__';
const GSLIDES_ICON_MARKER = '__gslides__';
const GDOCS_ICON_MARKER = '__gdocs__';
const WEEKLY_PLAN_ICON_MARKER = '__weekly_plan__';

const WIDGET_UI_SVGS = {
  [WEEKLY_PLAN_ICON_MARKER]: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <defs>
    <linearGradient id="wpHdrGrad" x1="5" y1="3" x2="19" y2="21" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ECE8FF"/>
      <stop offset="1" stop-color="#DCEEFF"/>
    </linearGradient>
  </defs>
  <rect x="3.5" y="3" width="17" height="18" rx="4.2" fill="url(#wpHdrGrad)" stroke="rgba(110,91,242,0.28)" stroke-width="1.1"/>
  <rect x="5.5" y="5" width="13" height="2.2" rx="1.1" fill="#6E5BF2" fill-opacity="0.22"/>
  <circle cx="7.2" cy="9.2" r="0.9" fill="#7c3aed"/><circle cx="9.8" cy="9.2" r="0.9" fill="#7c3aed"/>
  <circle cx="12.4" cy="9.2" r="0.9" fill="#7c3aed"/><circle cx="15" cy="9.2" r="0.9" fill="#7c3aed"/>
  <circle cx="17.6" cy="9.2" r="0.9" fill="#7c3aed"/>
  <rect x="6" y="11.5" width="12" height="7.5" rx="2" fill="#BFDBFE" fill-opacity="0.55"/>
  <circle cx="8.8" cy="14.2" r="1.5" fill="#F7B955"/>
  <path d="M6 18.2 L10 15.2 L13.5 17 L18 13.8 L18 18.2 Z" fill="#34C77B" fill-opacity="0.75"/>
</svg>`,
};

const GOOGLE_BRAND_SVGS = {
  /* Google Drive — 공식 6색 제품 로고 */
  [GDRIVE_ICON_MARKER]: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 87.3 78" width="20" height="18" aria-hidden="true">
  <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA"/>
  <path d="M43.65 25L29.9 0c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.5C.4 49.9 0 51.45 0 53h27.5z" fill="#00AC47"/>
  <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.85-1.45 1.25-3.1 1.25-4.75H60l5.55 10.55z" fill="#EA4335"/>
  <path d="M43.65 25l13.75-25c-1.35-.8-2.9-1.2-4.5-1.2H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832D"/>
  <path d="M60 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.5c1.6 0 3.15-.45 4.5-1.2z" fill="#2684FC"/>
  <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 60 53h27.4c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00"/>
</svg>`,
  /* Google Calendar — 2024 앱 런처 (파란 사각 + 상단 밴드 + 31) */
  [GCAL_ICON_MARKER]: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <rect x="3" y="3" width="18" height="18" rx="3.8" fill="#1A73E8"/>
  <path fill="#4285F4" d="M3 7.4C3 5.52 4.52 4 6.4 4h11.2C19.48 4 21 5.52 21 7.4V9H3V7.4z"/>
  <text x="12" y="17.2" text-anchor="middle" fill="#FFFFFF" font-size="9.5" font-weight="500" font-family="Google Sans,Roboto,Arial,sans-serif">31</text>
</svg>`,
  /* Google Tasks — 2024~2025 앱 런처 (파란 그라데이션 스쿼클 + 3D 립 + 체크) */
  [GTASK_ICON_MARKER]: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <defs>
    <linearGradient id="gtaskBrandGrad" x1="12" y1="2.8" x2="12" y2="18.5" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#1A73E8"/>
      <stop offset="0.42" stop-color="#4285F4"/>
      <stop offset="1" stop-color="#AECBFA"/>
    </linearGradient>
  </defs>
  <rect x="4" y="5.4" width="16" height="15.6" rx="5.2" fill="#1967D2"/>
  <rect x="3" y="3.2" width="18" height="16.2" rx="5.6" fill="url(#gtaskBrandGrad)"/>
  <path fill="#1967D2" fill-opacity="0.22" d="M3 14.8h18v4.6c0 .9-4.03 1.7-9 1.7S3 20.3 3 19.4V14.8z"/>
  <path fill="#FFFFFF" d="M10.15 15.75 7.35 13l1.4-1.4 1.4 1.4 4.35-4.35 1.4 1.4z"/>
</svg>`,
  /* Google Gemini — 2024 스파클 (4각 별 + 멀티컬러 그라데이션) */
  [GEMINI_ICON_MARKER]: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <defs>
    <linearGradient id="geminiBrandGrad" x1="4" y1="1.5" x2="20" y2="22.5" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#EA4335"/>
      <stop offset="0.22" stop-color="#FBBC04"/>
      <stop offset="0.48" stop-color="#34A853"/>
      <stop offset="0.72" stop-color="#4285F4"/>
      <stop offset="1" stop-color="#8E55EA"/>
    </linearGradient>
  </defs>
  <path fill="url(#geminiBrandGrad)" d="M12 2.2c.92 4.08 4 7.16 8.08 8-.08 4.08-3.16 7.16-8.08 8-.92-4.08-4-7.16-8.08-8 4.08-.84 7.16-3.92 8.08-8z"/>
</svg>`,
  /* Google Sheets — 세로 라운드 + 녹색 그라데이션 + 흰 격자 */
  [GSHEETS_ICON_MARKER]: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <defs>
    <linearGradient id="gsheetsBrandGrad" x1="12" y1="3" x2="12" y2="21" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#34A853"/>
      <stop offset="1" stop-color="#0D652D"/>
    </linearGradient>
  </defs>
  <rect x="5" y="3" width="14" height="18" rx="3.2" fill="url(#gsheetsBrandGrad)"/>
  <line x1="8" y1="8.5" x2="16" y2="8.5" stroke="#FFFFFF" stroke-width="1.25" stroke-linecap="round"/>
  <line x1="8" y1="12.5" x2="16" y2="12.5" stroke="#FFFFFF" stroke-width="1.25" stroke-linecap="round"/>
  <line x1="11" y1="8.5" x2="11" y2="16.5" stroke="#FFFFFF" stroke-width="1.25" stroke-linecap="round"/>
</svg>`,
  /* Google Slides — 가로 라운드 + 노란/골드 그라데이션 + 흰 슬라이드 윤곽 */
  [GSLIDES_ICON_MARKER]: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <defs>
    <linearGradient id="gslidesBrandGrad" x1="3" y1="12" x2="21" y2="12" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FBBC04"/>
      <stop offset="1" stop-color="#F29900"/>
    </linearGradient>
  </defs>
  <rect x="3" y="7" width="18" height="10" rx="2.8" fill="url(#gslidesBrandGrad)"/>
  <rect x="6" y="9.5" width="12" height="6.5" rx="1" fill="none" stroke="#FFFFFF" stroke-width="1.3"/>
</svg>`,
  /* Google Docs — 세로 라운드 + 파란 그라데이션 + 흰 가로줄 3개 */
  [GDOCS_ICON_MARKER]: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <defs>
    <linearGradient id="gdocsBrandGrad" x1="12" y1="3" x2="12" y2="21" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#4285F4"/>
      <stop offset="1" stop-color="#1967D2"/>
    </linearGradient>
  </defs>
  <rect x="6" y="3" width="12" height="18" rx="2.8" fill="url(#gdocsBrandGrad)"/>
  <line x1="9" y1="8" x2="15" y2="8" stroke="#FFFFFF" stroke-width="1.3" stroke-linecap="round"/>
  <line x1="9" y1="12" x2="14" y2="12" stroke="#FFFFFF" stroke-width="1.3" stroke-linecap="round"/>
  <line x1="9" y1="16" x2="12.5" y2="16" stroke="#FFFFFF" stroke-width="1.3" stroke-linecap="round"/>
</svg>`,
};

const GOOGLE_BRAND_TITLES = {
  [GDRIVE_ICON_MARKER]: 'Google Drive',
  [GCAL_ICON_MARKER]: 'Google Calendar',
  [GTASK_ICON_MARKER]: 'Google Tasks',
  [GEMINI_ICON_MARKER]: 'Google Gemini',
  [GSHEETS_ICON_MARKER]: 'Google Sheets',
  [GSLIDES_ICON_MARKER]: 'Google Slides',
  [GDOCS_ICON_MARKER]: 'Google Docs',
};

const WIDGET_BRAND_ICON = {
  calendar: GCAL_ICON_MARKER,
  drive: WEEKLY_PLAN_ICON_MARKER,
  todo: GTASK_ICON_MARKER,
  gemini: GEMINI_ICON_MARKER,
  gsheets: GSHEETS_ICON_MARKER,
  gslides: GSLIDES_ICON_MARKER,
  gdocs: GDOCS_ICON_MARKER,
};

const GWORKSPACE_WIDGET_TYPES = ['gsheets', 'gslides', 'gdocs'];

const GWORKSPACE_WIDGET_CONFIG = {
  gsheets: {
    mime: 'application/vnd.google-apps.spreadsheet',
    homeUrl: 'https://sheets.google.com',
    brand: 'sheets',
    iconClass: 'ch-icon-gsheets',
    fileUrl(id) { return `https://docs.google.com/spreadsheets/d/${id}/edit`; },
  },
  gslides: {
    mime: 'application/vnd.google-apps.presentation',
    homeUrl: 'https://slides.google.com',
    brand: 'slides',
    iconClass: 'ch-icon-gslides',
    fileUrl(id) { return `https://docs.google.com/presentation/d/${id}/edit`; },
  },
  gdocs: {
    mime: 'application/vnd.google-apps.document',
    homeUrl: 'https://docs.google.com',
    brand: 'docs',
    iconClass: 'ch-icon-gdocs',
    fileUrl(id) { return `https://docs.google.com/document/d/${id}/edit`; },
  },
};

function normalizeIconMarker(value) {
  if (!value || typeof value !== 'string') return value || '';
  const raw = value.trim();
  const v = raw.toLowerCase();
  if (v === GDRIVE_ICON_MARKER || v === '_gdrive' || v === 'gdrive' || v.includes('gdrive')) return GDRIVE_ICON_MARKER;
  if (v === GCAL_ICON_MARKER || v === '_gcal' || v === 'gcal' || v.includes('gcal')) return GCAL_ICON_MARKER;
  if (v === GTASK_ICON_MARKER || v === '_gtask' || v === 'gtask' || v.includes('gtask')) return GTASK_ICON_MARKER;
  if (v === GEMINI_ICON_MARKER || v === '_gemini' || v === 'gemini' || v.includes('gemini')) return GEMINI_ICON_MARKER;
  if (v === GSHEETS_ICON_MARKER || v === '_gsheets' || v === 'gsheets' || v.includes('gsheets')) return GSHEETS_ICON_MARKER;
  if (v === GSLIDES_ICON_MARKER || v === '_gslides' || v === 'gslides' || v.includes('gslides')) return GSLIDES_ICON_MARKER;
  if (v === GDOCS_ICON_MARKER || v === '_gdocs' || v === 'gdocs' || v.includes('gdocs')) return GDOCS_ICON_MARKER;
  if (v === WEEKLY_PLAN_ICON_MARKER || v === '_weekly_plan' || v === 'weekly_plan' || v.includes('weekly_plan')) {
    return WEEKLY_PLAN_ICON_MARKER;
  }
  return raw;
}

function isGoogleBrandMarker(value) {
  const m = normalizeIconMarker(value);
  return m === GDRIVE_ICON_MARKER || m === GCAL_ICON_MARKER || m === GTASK_ICON_MARKER
    || m === GEMINI_ICON_MARKER || m === GSHEETS_ICON_MARKER || m === GSLIDES_ICON_MARKER
    || m === GDOCS_ICON_MARKER;
}

function scaledWidgetSvg(marker, size) {
  const raw = WIDGET_UI_SVGS[marker];
  if (!raw) return '';
  const s = size || 20;
  return raw.replace(/width="\d+"/, `width="${s}"`).replace(/height="\d+"/, `height="${s}"`);
}

function scaledBrandSvg(marker, size) {
  const svg = GOOGLE_BRAND_SVGS[marker];
  if (!svg) return '';
  const h = Math.round(size * (marker === GDRIVE_ICON_MARKER ? 0.9 : 1));
  let out = svg
    .replace(/width="\d+"/, `width="${size}"`)
    .replace(/height="\d+"/, `height="${h}"`);
  const gradMarkers = {
    [GEMINI_ICON_MARKER]: 'geminiBrandGrad',
    [GTASK_ICON_MARKER]: 'gtaskBrandGrad',
    [GSHEETS_ICON_MARKER]: 'gsheetsBrandGrad',
    [GSLIDES_ICON_MARKER]: 'gslidesBrandGrad',
    [GDOCS_ICON_MARKER]: 'gdocsBrandGrad',
  };
  const gradBase = gradMarkers[marker];
  if (gradBase) {
    const gradId = `${gradBase}_${size}_${Math.random().toString(36).slice(2, 8)}`;
    const re = new RegExp(`id="${gradBase}"`, 'g');
    out = out.replace(re, `id="${gradId}"`)
      .replace(new RegExp(`url\\(#${gradBase}\\)`, 'g'), `url(#${gradId})`);
  }
  return out;
}

function renderIcon(container, iconValue, svgSize) {
  if (!container) return;
  const marker = normalizeIconMarker(iconValue);
  if (GOOGLE_BRAND_SVGS[marker]) {
    container.innerHTML = scaledBrandSvg(marker, svgSize || 20);
    container.classList.add('has-brand-icon');
    return;
  }
  if (WIDGET_UI_SVGS[marker]) {
    container.innerHTML = scaledWidgetSvg(marker, svgSize || 20);
    container.classList.add('has-brand-icon');
    return;
  }
  container.classList.remove('has-brand-icon');
  container.textContent = iconValue || '';
}

function renderBrandIcon(container, brand, svgSize) {
  const map = {
    drive: WEEKLY_PLAN_ICON_MARKER,
    calendar: GCAL_ICON_MARKER,
    tasks: GTASK_ICON_MARKER,
    gemini: GEMINI_ICON_MARKER,
    sheets: GSHEETS_ICON_MARKER,
    slides: GSLIDES_ICON_MARKER,
    docs: GDOCS_ICON_MARKER,
  };
  renderIcon(container, map[brand], svgSize);
}

function wpEmptyIconSvg(size = 52, uid = `wp${Math.random().toString(36).slice(2, 9)}`) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56" width="${size}" height="${size}" aria-hidden="true">
  <defs>
    <linearGradient id="${uid}F" x1="8" y1="8" x2="48" y2="48" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ECE8FF"/>
      <stop offset="1" stop-color="#DCEEFF"/>
    </linearGradient>
    <linearGradient id="${uid}S" x1="14" y1="14" x2="14" y2="38" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#BFDBFE" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#C4B5FD" stop-opacity="0.55"/>
    </linearGradient>
    <linearGradient id="${uid}H" x1="14" y1="28" x2="42" y2="36" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#6EE7B7"/>
      <stop offset="1" stop-color="#34C77B"/>
    </linearGradient>
  </defs>
  <rect x="7" y="9" width="42" height="38" rx="10" fill="url(#${uid}F)" stroke="rgba(255,255,255,0.88)" stroke-width="1.6"/>
  <rect x="11" y="13" width="34" height="26" rx="6" fill="url(#${uid}S)"/>
  <circle cx="19" cy="21" r="4.2" fill="#F7B955"/>
  <circle cx="19" cy="21" r="2.4" fill="#FFF3D6" fill-opacity="0.65"/>
  <path d="M11 37 L20.5 27.5 L28 32.5 L35.5 25 L45 37 Z" fill="url(#${uid}H)" fill-opacity="0.82"/>
  <path d="M11 37 H45" stroke="rgba(255,255,255,0.55)" stroke-width="1.2" stroke-linecap="round"/>
  <rect x="11" y="39" width="34" height="5" rx="2.5" fill="rgba(255,255,255,0.72)"/>
  <circle cx="42" cy="16" r="2.2" fill="#6E5BF2" fill-opacity="0.45"/>
  <path d="M40.5 14.5 L43.5 14.5 M42 13 L42 16" stroke="#FFFFFF" stroke-width="1.1" stroke-linecap="round"/>
</svg>`;
}

function renderWpEmptyIcon(container, size = 52) {
  if (!container) return;
  container.className = 'wp-empty-icon';
  container.setAttribute('aria-hidden', 'true');
  container.innerHTML = wpEmptyIconSvg(size);
}

const WP_EMPTY_MAIN = '연결한 폴더의 사진이 이곳에 표시돼요';
const WP_EMPTY_SUB = '손글씨 플래너 · 메모 사진 등';

function wpEmptyStateMarkup(main, iconSize = 48, sub = '') {
  const uid = `wp${Math.random().toString(36).slice(2, 9)}`;
  const subHtml = sub ? `<span class="wp-empty-sub">${sub}</span>` : '';
  return `<div class="wp-empty-icon" aria-hidden="true">${wpEmptyIconSvg(iconSize, uid)}</div>`
    + `<div class="wp-empty-msg">${main}${subHtml}</div>`;
}

function _bindServiceIconClick(el, handler) {
  if (!el || typeof handler !== 'function') return;
  el.style.cursor = 'pointer';
  el.onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    handler();
  };
}

const WIDGET_TYPE_PICKER_LABELS = {
  calendar: '달력', drive: 'Drive', todo: '할 일',
  gsheets: 'Sheets', gslides: 'Slides', gdocs: 'Docs',
  category: '카테고리', clock: '시계', sticky: '메모',
  pomodoro: '뽀모도로', dday: 'D-Day', weather: '날씨', gemini: 'Gemini',
};

function initWidgetTypePickerIcons() {
  document.querySelectorAll('#widgetTypePicker .widget-type-opt').forEach((btn) => {
    const type = btn.dataset.widgetType;
    if (!type) return;
    btn.innerHTML = '';
    const iconWrap = document.createElement('span');
    iconWrap.className = 'widget-type-opt-icon';
    const label = document.createElement('span');
    label.className = 'widget-type-opt-label';
    label.textContent = WIDGET_TYPE_PICKER_LABELS[type] || type;
    const brandMarker = WIDGET_BRAND_ICON[type];
    if (brandMarker) {
      renderIcon(iconWrap, brandMarker, 40);
    } else {
      iconWrap.textContent = SP_WIDGET_TYPE_ICONS[type] || '🧩';
    }
    btn.appendChild(iconWrap);
    btn.appendChild(label);
  });
}

function _appendChGear(chEl, widgetId) {
  if (!chEl || !widgetId) return;
  chEl.querySelector('.ch-gear')?.remove();
  const gear = document.createElement('div');
  gear.className = 'ch-gear';
  gear.textContent = '⚙';
  gear.title = '위젯 설정';
  gear.addEventListener('click', (e) => {
    e.stopPropagation();
    void openWidgetSourceDialog(widgetId);
  });
  chEl.appendChild(gear);
}

function openGoogleTasks() {
  void openExternalUrl('https://tasks.google.com');
}

function openDriveWidgetFolder(widgetId) {
  const w = _widgetGridState?.widgets?.find((x) => x.id === widgetId);
  const folderId = w?.source?.folderId?.trim();
  const url = folderId
    ? `https://drive.google.com/drive/folders/${folderId}`
    : 'https://drive.google.com';
  void openExternalUrl(url);
}

function openSettings(){
  spScale = userScale;

  // UI 초기화
  renderSpWidgetList();
  syncSpScaleUI(spScale);
  buildColorPalette();
  const addW = document.getElementById('spAddWidgetBtn');
  if (addW && !addW.dataset.bound) {
    addW.dataset.bound = '1';
    addW.addEventListener('click', () => {
      closeSettings();
      openWidgetTypePicker();
    });
  }

  // 탭 초기화
  switchSpTab('display');

  // Google 연결 상태 UI 즉시 반영
  getAuthStatus().then(s => updateSettingsGoogleStatus(s.authenticated));

  // Drive 폴더 ID 복원
  const spW = document.getElementById('spWeeklyId');
  const spM = document.getElementById('spMemoId');
  if(spW) spW.value = localStorage.getItem('driveWeeklyId') || '';
  if(spM) spM.value = localStorage.getItem('driveMemoId')   || '';

  // 자동 실행 상태 동기화
  initAutoLaunchUI();

  // 앱 버전 표시
  loadAppVersionDisplay();
  // 업데이트 상태 초기화
  setSpUpdateStatus('');
  setSpUpdateBtnState(false);

  document.getElementById('settingsOverlay').classList.add('sp-open');
}

function closeSettings(){
  document.getElementById('settingsOverlay').classList.remove('sp-open');
  // 팔레트 닫기 (pal-open 클래스 제거)
  document.getElementById('colorPalette').classList.remove('pal-open');
}

/* 탭 전환 */
function switchSpTab(tab){
  document.querySelectorAll('.sp-tab').forEach(el =>
    el.classList.toggle('sp-tab-active', el.dataset.tab === tab));
  document.querySelectorAll('.sp-tab-pane').forEach(el =>
    el.classList.toggle('sp-pane-active', el.id === 'sppane-'+tab));
}

/* 해상도 선택 */
function spSelRes(el){
  document.querySelectorAll('.res-chip').forEach(e => e.classList.remove('sel'));
  el.classList.add('sel');
}

/* 배율 슬라이더 */
function spScaleInput(val){
  spScale = parseInt(val);
  syncSpScaleUI(spScale);
  applyScale(spScale); // 실시간 미리보기
}
function spScalePreset(val){
  spScale = val;
  document.getElementById('spScaleSlider').value = val;
  syncSpScaleUI(val);
  applyScale(val);
}
function syncSpScaleUI(val){
  const pct = (val-70)/(150-70)*100;
  const sl = document.getElementById('spScaleSlider');
  if(sl){ sl.value = val; sl.style.setProperty('--pct', pct+'%'); }
  const sv = document.getElementById('spScaleVal');
  if(sv) sv.textContent = val + '%';
  document.querySelectorAll('.sp-preset-btn').forEach(el => {
    el.classList.toggle('sel', parseInt(el.textContent) === val);
  });
}

/* ── 설정: 위젯 목록 ── */
function renderSpWidgetList() {
  const list = document.getElementById('spWidgetList');
  if (!list) return;
  list.innerHTML = '';
  const widgets = _widgetGridState?.widgets || [];
  if (!widgets.length) {
    list.innerHTML = '<p class="sp-inp-hint">등록된 위젯이 없습니다. 아래에서 추가하세요.</p>';
    return;
  }
  for (const w of widgets) {
    const row = document.createElement('div');
    row.className = 'sp-widget-row';
    row.dataset.widgetId = w.id;

    const icon = document.createElement('div');
    icon.className = 'sp-widget-row-icon';
    if (w.type === 'category') {
      renderIcon(icon, w.icon || SP_WIDGET_TYPE_ICONS.category, 20);
    } else if (WIDGET_BRAND_ICON[w.type]) {
      renderIcon(icon, WIDGET_BRAND_ICON[w.type], 20);
    } else {
      icon.textContent = SP_WIDGET_TYPE_ICONS[w.type] || '🧩';
    }

    const meta = document.createElement('div');
    meta.className = 'sp-widget-row-meta';
    const title = document.createElement('div');
    title.className = 'sp-widget-row-title';
    title.textContent = w.title || SP_WIDGET_TYPE_LABELS[w.type] || w.id;
    const type = document.createElement('div');
    type.className = 'sp-widget-row-type';
    type.textContent = `${SP_WIDGET_TYPE_LABELS[w.type] || w.type} · ${w.id}`;
    meta.appendChild(title);
    meta.appendChild(type);

    const actions = document.createElement('div');
    actions.className = 'sp-widget-row-actions';
    const cfgBtn = document.createElement('button');
    cfgBtn.type = 'button';
    cfgBtn.className = 'sp-widget-act';
    cfgBtn.textContent = '설정';
    cfgBtn.addEventListener('click', () => { void spConfigureWidget(w.id); });
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'sp-widget-act del';
    delBtn.textContent = '삭제';
    delBtn.addEventListener('click', () => { void spDeleteWidget(w.id); });
    actions.appendChild(cfgBtn);
    actions.appendChild(delBtn);

    row.appendChild(icon);
    row.appendChild(meta);
    row.appendChild(actions);
    list.appendChild(row);
  }
}

async function spConfigureWidget(widgetId) {
  const w = _widgetGridState?.widgets?.find((x) => x.id === widgetId);
  if (!w) return;
  if (w.type === 'category') {
    const m = /^cat-(\d+)$/.exec(w.id || '');
    const idx = m ? parseInt(m[1], 10) - 1 : CATS.findIndex((c) => c.name === w.title);
    if (idx >= 0 && CATS[idx]) {
      closeSettings();
      openCatEditPopup({ clientX: 0, clientY: 0, stopPropagation() {} }, idx);
      return;
    }
  }
  closeSettings();
  await openWidgetSourceDialog(widgetId);
}

async function spDeleteWidget(widgetId) {
  if (!_widgetGridState) return;
  const w = _widgetGridState.widgets.find((x) => x.id === widgetId);
  if (!w) return;
  const label = w.title || SP_WIDGET_TYPE_LABELS[w.type] || widgetId;
  if (!confirm(`「${label}」 위젯을 삭제할까요?`)) return;
  await deleteWidgetById(widgetId, { confirm: false });
  renderSpWidgetList();
}

/* ── 카테고리 편집 (레거시 — 카테고리 편집 팝업용) ── */
function renderSpCatList(){
  const list = document.getElementById('spCatList');
  list.innerHTML = '';
  spCats.forEach((cat, idx) => {
    const item = document.createElement('div');
    item.className = 'cat-edit-row';
    item.dataset.idx = idx;

    // 드래그 핸들
    const handle = document.createElement('div');
    handle.className = 'cat-drag';
    handle.title = '드래그로 순서 변경';
    handle.innerHTML = '⠿⠿';

    // 아이콘 입력 (Drive 아이콘은 SVG 프리뷰, 일반 아이콘은 텍스트 입력)
    let iconInp;
    if (isGoogleBrandMarker(cat.icon)) {
      iconInp = document.createElement('div');
      iconInp.className = 'cat-icon-inp';
      iconInp.style.cssText = 'display:flex;align-items:center;justify-content:center;cursor:default';
      iconInp.title = GOOGLE_BRAND_TITLES[normalizeIconMarker(cat.icon)] || 'Google 아이콘';
      renderIcon(iconInp, cat.icon, 18);
    } else {
      iconInp = document.createElement('input');
      iconInp.className = 'cat-icon-inp';
      iconInp.value = cat.icon;
      iconInp.maxLength = 2;
      iconInp.title = '아이콘 클릭 편집';
      iconInp.addEventListener('input', e => { spCats[idx].icon = e.target.value; });
    }

    // 색상 스와치
    const swatch = document.createElement('div');
    swatch.className = 'cat-swatch';
    swatch.style.background = cat.color;
    swatch.title = '색상 변경';
    swatch.addEventListener('click', e => {
      e.stopPropagation();
      activePaletteCatIdx = idx;
      const palette = document.getElementById('colorPalette');
      const r = swatch.getBoundingClientRect();
      const panelR = document.querySelector('.settings-panel').getBoundingClientRect();
      palette.style.top  = (r.bottom - panelR.top + 6) + 'px';
      palette.style.left = Math.max(0, r.left - panelR.left - 80) + 'px';
      palette.style.position = 'absolute';
      palette.classList.toggle('pal-open');
    });

    // 이름 입력
    const nameInp = document.createElement('input');
    nameInp.className = 'cat-name-inp';
    nameInp.value = cat.name;
    nameInp.placeholder = '카테고리 이름';
    nameInp.addEventListener('input', e => { spCats[idx].name = e.target.value; });

    // 삭제 버튼
    const delBtn = document.createElement('button');
    delBtn.className = 'cat-row-del';
    delBtn.title = '삭제';
    delBtn.innerHTML = '🗑';
    delBtn.addEventListener('click', () => {
      if(spCats.length <= 2){ showToast('⚠️ 최소 2개 이상 필요해요'); return; }
      spCats.splice(idx, 1);
      renderSpCatList();
    });

    item.appendChild(handle);
    item.appendChild(iconInp);
    item.appendChild(swatch);
    item.appendChild(nameInp);
    item.appendChild(delBtn);
    list.appendChild(item);
  });
  initDragSort();
}

/* 카테고리 추가 */
function spAddCat(){
  if(spCats.length >= 8){ showToast('⚠️ 최대 8개까지 추가할 수 있어요'); return; }
  const rainbowIdx = spCats.length % RAINBOW_COLORS.length;
  spCats.push({
    id: 'c' + Date.now(),
    color: RAINBOW_COLORS[rainbowIdx],
    tc: '#374151',
    icon: '📌',
    name: '새 카테고리',
    sub: 'NEW',
    note: '', items: []
  });
  renderSpCatList();
  // 스크롤 하단으로
  setTimeout(() => {
    const list = document.getElementById('spCatList');
    list.lastElementChild?.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }, 50);
}

/* 컬러 팔레트 빌드 */
function buildColorPalette(){
  const palette = document.getElementById('colorPalette');
  palette.innerHTML = '';
  RAINBOW_COLORS.forEach(color => {
    const sw = document.createElement('div');
    sw.className = 'pal-swatch';
    sw.style.background = color;
    sw.title = color;
    sw.addEventListener('click', () => {
      if(activePaletteCatIdx < 0) return;
      spCats[activePaletteCatIdx].color = color;
      renderSpCatList();
      palette.classList.remove('pal-open');
      activePaletteCatIdx = -1;
    });
    palette.appendChild(sw);
  });
}

/* 팔레트 외부 클릭 닫기 */
document.addEventListener('click', e => {
  const palette = document.getElementById('colorPalette');
  if(palette && !e.target.closest('.cat-color-swatch') && !e.target.closest('#colorPalette')){
    palette.classList.remove('pal-open');
  }
});

/* 드래그 정렬 — 핸들 mousedown 기반 */
let dragSrcIdx = null;
function initDragSort(){
  const list = document.getElementById('spCatList');
  if(!list) return;

  let dragEl = null, ghost = null, ghostOffsetY = 0;

  list.querySelectorAll('.cat-edit-row').forEach((item, idx) => {
    const handle = item.querySelector('.cat-drag');
    if(!handle) return;

    handle.addEventListener('mousedown', e => {
      if(e.button !== 0) return;
      e.preventDefault();

      dragSrcIdx = idx;
      dragEl = item;

      // 고스트 생성 (드래그 중 따라다니는 단순 미리보기)
      const rect = item.getBoundingClientRect();
      ghostOffsetY = e.clientY - rect.top;
      const cat = spCats[idx];
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.style.cssText = `width:${rect.width}px;top:${rect.top}px;left:${rect.left}px;padding:9px 14px;display:flex;align-items:center;gap:9px`;
      const dot = document.createElement('div');
      dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${cat.color};flex-shrink:0`;
      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'font-size:13.5px;font-weight:600;color:#334155;pointer-events:none';
      nameSpan.textContent = cat.name || '';
      ghost.appendChild(dot);
      ghost.appendChild(nameSpan);
      document.body.appendChild(ghost);
      item.classList.add('drag-src');

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });

  function clearIndicators(){
    list.querySelectorAll('.drag-above,.drag-below')
        .forEach(it => it.classList.remove('drag-above','drag-below'));
  }

  function getTargetInfo(clientY){
    const items = [...list.querySelectorAll('.cat-edit-row')];
    for(const it of items){
      if(it === dragEl) continue;
      const r = it.getBoundingClientRect();
      if(clientY >= r.top && clientY <= r.bottom){
        const above = clientY < r.top + r.height / 2;
        return { el: it, idx: parseInt(it.dataset.idx), above };
      }
    }
    return null;
  }

  function onMove(e){
    if(!ghost) return;
    ghost.style.top = (e.clientY - ghostOffsetY) + 'px';

    clearIndicators();
    const info = getTargetInfo(e.clientY);
    if(info) info.el.classList.add(info.above ? 'drag-above' : 'drag-below');
  }

  function onUp(e){
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);

    const info = getTargetInfo(e.clientY);

    if(ghost){ ghost.remove(); ghost = null; }
    if(dragEl){ dragEl.classList.remove('drag-src'); }
    clearIndicators();

    if(info && dragSrcIdx !== null && info.idx !== dragSrcIdx){
      const moved = spCats.splice(dragSrcIdx, 1)[0];
      // splice 후 인덱스 보정
      let insertIdx = info.idx > dragSrcIdx ? info.idx - 1 : info.idx;
      if(!info.above) insertIdx++;
      spCats.splice(Math.max(0, Math.min(insertIdx, spCats.length)), 0, moved);
      renderSpCatList();
    }

    dragEl = null;
    dragSrcIdx = null;
  }
}

/* ── 적용 ── */
async function applySettings(){
  try {
    // 1) 배율 적용
    applyScale(spScale);

    // 2) Drive 폴더 ID 저장
    const wId = document.getElementById('spWeeklyId')?.value?.trim() || '';
    const mId = document.getElementById('spMemoId')?.value?.trim()   || '';
    localStorage.setItem('driveWeeklyId', wId);
    localStorage.setItem('driveMemoId',   mId);

    // 5) 배율 저장
    localStorage.setItem('appScale', String(userScale));

    // 6) Google 연결 상태·Drive 패널 동기화 (UI만 연결됨 / API 실패 불일치 방지)
    const auth = await getAuthStatus();
    updateGoogleChip(auth.authenticated);
    updateSettingsGoogleStatus(auth.authenticated);
    if (auth.authenticated) {
      reloadDriveImages();
      syncCalendarSilent();
      initGoogleTasksSync();
    } else if (await isAuthenticated()) {
      showToast('⚠️ Google 토큰 갱신 실패 — 설정 > Google에서 다시 연결해 주세요', 5000);
    }

    showToast('✅ 설정이 적용됐어요!');
  } catch(err) {
    console.error('applySettings error:', err);
    showToast('⚠️ 설정 적용 중 오류가 발생했어요');
  } finally {
    closeSettings(); // 오류가 발생해도 반드시 닫기
  }
}

/* 유틸 */
function lightenColor(hex){
  const r=Math.min(255,parseInt(hex.slice(1,3),16)+70),
        g=Math.min(255,parseInt(hex.slice(3,5),16)+70),
        b=Math.min(255,parseInt(hex.slice(5,7),16)+70);
  return `rgb(${r},${g},${b})`;
}
function darkenColor(hex){
  const r=Math.max(0,parseInt(hex.slice(1,3),16)-80),
        g=Math.max(0,parseInt(hex.slice(3,5),16)-80),
        b=Math.max(0,parseInt(hex.slice(5,7),16)-80);
  return `rgb(${r},${g},${b})`;
}

/* ESC 닫기 */
document.addEventListener('keydown', e => {
  if(e.key==='Escape'){
    if(document.getElementById('evDialog').classList.contains('evd-open')) closeEvDialog();
    else closeSettings();
  }
});

/* ════════════════════════════════════════
   일정 추가 다이얼로그
════════════════════════════════════════ */
var evdSelectedColor = '#60a5fa';

const EVD_COLORS = [
  { hex:'#c084fc', id:'1' }, { hex:'#6ee7b7', id:'2' },
  { hex:'#60a5fa', id:'3' }, { hex:'#f472b6', id:'4' },
  { hex:'#fbbf24', id:'5' }, { hex:'#fb923c', id:'6' },
  { hex:'#2dd4bf', id:'7' }, { hex:'#818cf8', id:'8' },
  { hex:'#4ade80', id:'9' }, { hex:'#f87171', id:'10'},
  { hex:'#94a3b8', id:'11'}, { hex:'#a78bfa', id:'1' },
];

function evdBuildColors(){
  const row = document.getElementById('evdColorRow');
  row.innerHTML = '';
  EVD_COLORS.forEach(({hex}) => {
    const sw = document.createElement('div');
    sw.className = 'evd-csw' + (hex === evdSelectedColor ? ' evd-csel' : '');
    sw.style.background = hex;
    sw.title = hex;
    sw.onclick = () => {
      evdSelectedColor = hex;
      row.querySelectorAll('.evd-csw').forEach(s => s.classList.remove('evd-csel'));
      sw.classList.add('evd-csel');
    };
    row.appendChild(sw);
  });
}

/* year/month(0-indexed)/day : 새 일정 추가
   existingEv : 수정 시 기존 이벤트 객체 전달 */
var evdEditingId = null;
var _evdCalendarId = null;

function colorIdToHex(id){
  const found = EVD_COLORS.find(c => c.id === String(id));
  return found ? found.hex : '#60a5fa';
}

/* ════════════════════════════════════════
   날짜/시간 칩 피커 시스템
════════════════════════════════════════ */
let _dpCb = null, _dpYear = null, _dpMonth = null, _dpSelYmd = '', _dpChipEl = null;
let _tpCb = null, _tpChipEl = null;

function _p2(n){ return String(n).padStart(2,'0'); }

function formatDateKor(ymd){
  if(!ymd) return '날짜 선택';
  const d = new Date(ymd + 'T00:00:00');
  const m = d.getMonth()+1, dy = d.getDate();
  return `${m}월 ${dy}일 (${'일월화수목금토'[d.getDay()]})`;
}
function formatTimeKor(hhmm){
  if(!hhmm) return '시간 선택';
  const [h,m] = hhmm.split(':').map(Number);
  const ap = h < 12 ? '오전' : '오후';
  const hr = h===0?12:h>12?h-12:h;
  return `${ap} ${hr}:${_p2(m)}`;
}
function formatDateTimeKor(dtStr){
  if(!dtStr) return '날짜/시간 선택';
  const [ymd, hhmm] = dtStr.split('T');
  return formatDateKor(ymd) + '  ' + formatTimeKor(hhmm ? hhmm.slice(0,5) : '');
}

/** `YYYY-MM-DDTHH:mm` 로컬 시각 → epoch (브라우저별 Date 파싱 차이 방지) */
function parseLocalDateTime(dtStr) {
  if (!dtStr) return NaN;
  const m = String(dtStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0).getTime();
}

// ─── Setters (hidden input + chip 텍스트 동시 갱신) ───
function setEvDate(ymd){
  document.getElementById('evdDate').value = ymd;
  document.getElementById('evdDateChip').textContent = formatDateKor(ymd);
}
function setEvTime(inputId, hhmm){
  document.getElementById(inputId).value = hhmm;
  const chipId = inputId==='evdStartTime' ? 'evdStartChip' : 'evdEndChip';
  document.getElementById(chipId).textContent = formatTimeKor(hhmm);
}
function splitDtStr(dtStr) {
  if (!dtStr) return { ymd: '', hm: '09:00' };
  const [ymd, rest] = String(dtStr).split('T');
  return { ymd: ymd || '', hm: (rest || '09:00').slice(0, 5) };
}
function updateDtChipPair(dateChipId, timeChipId, dtStr) {
  const { ymd, hm } = splitDtStr(dtStr);
  const dateEl = document.getElementById(dateChipId);
  const timeEl = document.getElementById(timeChipId);
  if (dateEl) dateEl.textContent = ymd ? formatDateKor(ymd) : '날짜 선택';
  if (timeEl) timeEl.textContent = hm ? formatTimeKor(hm) : '시간 선택';
}
function setEvAlarmDT(dtStr){
  document.getElementById('evdAlarmDT').value = dtStr;
  updateDtChipPair('evdAlarmDateChip', 'evdAlarmTimeChip', dtStr);
}
function setAmpDt(dtStr){
  document.getElementById('ampDtInput').value = dtStr;
  updateDtChipPair('ampDateChip', 'ampTimeChip', dtStr);
}
function mergeDtYmdHm(ymd, hm) {
  const y = ymd || new Date().toISOString().slice(0, 10);
  const t = hm || '09:00';
  return `${y}T${t}`;
}

// ─── 날짜 피커 ───
function openChipDatePicker(chipEl, selYmd, callback){
  closeChipTimePicker();
  _dpCb = callback; _dpChipEl = chipEl; _dpSelYmd = selYmd || '';
  const d = selYmd ? new Date(selYmd+'T00:00:00') : new Date();
  _dpYear = d.getFullYear(); _dpMonth = d.getMonth();
  _renderDpMonth();

  const picker = document.getElementById('evdDatePicker');
  const r = chipEl.getBoundingClientRect();
  let top  = r.bottom + 6, left = r.left;
  if(left + 252 > window.innerWidth)  left = window.innerWidth  - 258;
  if(top  + 310 > window.innerHeight) top  = r.top - 314;
  picker.style.top = top+'px'; picker.style.left = left+'px';
  picker.classList.add('dp-open');
  chipEl.classList.add('chip-open');
  // alarmMiniOverlay가 피커 클릭을 가로채지 않도록 일시 비활성
  const ov = document.getElementById('alarmMiniOverlay');
  if(ov && ov.style.display !== 'none') ov.style.pointerEvents = 'none';
  setTimeout(()=> document.addEventListener('mousedown', _dpOutside), 0);
}
function _dpOutside(e){
  const p = document.getElementById('evdDatePicker');
  if(!p.contains(e.target) && e.target !== _dpChipEl){ closeChipDatePicker(false); }
  else setTimeout(()=> document.addEventListener('mousedown', _dpOutside, {once:true}), 0);
}
function closeChipDatePicker(fromSelect){
  const p = document.getElementById('evdDatePicker');
  p.classList.remove('dp-open');
  document.removeEventListener('mousedown', _dpOutside);
  if(!fromSelect && _dpChipEl) _dpChipEl.classList.remove('chip-open');
  // 시간 피커가 연속으로 열리지 않는 경우에만 overlay 복원
  if(!fromSelect){
    const ov = document.getElementById('alarmMiniOverlay');
    if(ov) ov.style.pointerEvents = '';
  }
}
function _renderDpMonth(){
  document.getElementById('evdDpMonthLbl').textContent = `${_dpYear}년 ${_dpMonth+1}월`;
  const box = document.getElementById('evdDpDays'); box.innerHTML = '';
  const firstDay = new Date(_dpYear, _dpMonth, 1).getDay();
  const lastDate = new Date(_dpYear, _dpMonth+1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0,10);
  for(let i=0; i<firstDay; i++){
    const e = document.createElement('div'); e.className='evd-dp-day dp-empty'; box.appendChild(e);
  }
  for(let d=1; d<=lastDate; d++){
    const ymd = `${_dpYear}-${_p2(_dpMonth+1)}-${_p2(d)}`;
    const el  = document.createElement('div'); el.className='evd-dp-day';
    if(ymd===todayStr) el.classList.add('dp-today');
    if(ymd===_dpSelYmd) el.classList.add('dp-sel');
    el.textContent = d;
    el.addEventListener('mousedown', ev=>{
      ev.stopPropagation();
      _dpSelYmd = ymd;
      const cb = _dpCb, chip = _dpChipEl;
      closeChipDatePicker(true);
      if(chip) chip.classList.remove('chip-open');
      if(cb) cb(ymd);
    });
    box.appendChild(el);
  }
}
document.addEventListener('DOMContentLoaded', ()=>{
  /* 캡처 이미지 수신 (5단계에서 Tauri 이벤트로 완전 구현 예정) */
  // TODO Stage 5: tListen('capture-image-ready', (evt) => { _icpSelected = evt.payload; ... })
  /* capture-image-ready — Rust 또는 JS에서 이 이벤트를 emit하면 아이콘 피커에 바로 반영 */
  tListen('capture-image-ready', (evt) => {
    const dataURL = evt.payload;
    _icpSetImage(dataURL, '📸 캡처 이미지');
    // 아이콘 피커가 닫혀 있으면 다시 열기 (캡처 후 복귀 시)
    const popup = document.getElementById('icpPopup');
    if (popup && popup.style.display === 'none') {
      showIconPicker(window.innerWidth / 2 - 154, window.innerHeight / 2 - 180);
    }
    showToast('✅ 캡처 이미지를 가져왔어요!');
  });

  document.getElementById('evdDpPrev').addEventListener('click', e=>{
    e.stopPropagation();
    if(--_dpMonth < 0){ _dpMonth=11; _dpYear--; } _renderDpMonth();
  });
  document.getElementById('evdDpNext').addEventListener('click', e=>{
    e.stopPropagation();
    if(++_dpMonth > 11){ _dpMonth=0; _dpYear++; } _renderDpMonth();
  });

  // 칩 클릭 핸들러
  document.getElementById('evdDateChip').onclick = function(){
    openChipDatePicker(this, document.getElementById('evdDate').value, ymd=>{ setEvDate(ymd); });
  };
  document.getElementById('evdStartChip').onclick = function(){
    openChipTimePicker(this, document.getElementById('evdStartTime').value||'09:00', hhmm=>{
      setEvTime('evdStartTime', hhmm);
      // 종료 시간 자동 보정 (시작+1h, 단 현재 종료가 더 늦으면 유지)
      const [h,m] = hhmm.split(':').map(Number);
      const endH = (h+1)%24;
      const autoEnd = `${_p2(endH)}:${_p2(m)}`;
      const curEnd = document.getElementById('evdEndTime').value;
      const toM = s=>{ if(!s) return 0; const [a,b]=s.split(':').map(Number); return a*60+b; };
      if(!curEnd || toM(autoEnd) > toM(curEnd)) setEvTime('evdEndTime', autoEnd);
    }, { minuteStep: 1 });
  };
  document.getElementById('evdEndChip').onclick = function(){
    openChipTimePicker(this, document.getElementById('evdEndTime').value||'10:00', hhmm=>{
      setEvTime('evdEndTime', hhmm);
    }, { minuteStep: 1 });
  };
  document.getElementById('evdAlarmDateChip').onclick = function(){
    const cur = splitDtStr(document.getElementById('evdAlarmDT').value);
    const curYmd = cur.ymd || document.getElementById('evdDate').value || '';
    openChipDatePicker(this, curYmd, ymd => {
      setEvAlarmDT(mergeDtYmdHm(ymd, cur.hm));
    });
  };
  document.getElementById('evdAlarmTimeChip').onclick = function(){
    const cur = splitDtStr(document.getElementById('evdAlarmDT').value);
    const curHm = cur.hm || document.getElementById('evdStartTime').value || '09:00';
    const curYmd = cur.ymd || document.getElementById('evdDate').value || '';
    openChipTimePicker(this, curHm, hhmm => {
      setEvAlarmDT(mergeDtYmdHm(curYmd, hhmm));
    }, { minuteStep: 1 });
  };
  document.getElementById('ampDateChip').onclick = function(){
    const cur = splitDtStr(document.getElementById('ampDtInput').value);
    const curYmd = cur.ymd || new Date().toISOString().slice(0, 10);
    openChipDatePicker(this, curYmd, ymd => {
      setAmpDt(mergeDtYmdHm(ymd, cur.hm));
    });
  };
  document.getElementById('ampTimeChip').onclick = function(){
    const cur = splitDtStr(document.getElementById('ampDtInput').value);
    openChipTimePicker(this, cur.hm || '09:00', hhmm => {
      setAmpDt(mergeDtYmdHm(cur.ymd, hhmm));
    }, { minuteStep: 1 });
  };
});

// ─── 시간 피커 (options.minuteStep: 1=알림, 30=일정 시작/종료 기본) ───
function openChipTimePicker(chipEl, curHhmm, callback, options = {}){
  const minuteStep = options.minuteStep ?? 30;
  const ov = document.getElementById('alarmMiniOverlay');
  if(ov && ov.style.display !== 'none') ov.style.pointerEvents = 'none';
  closeChipDatePicker(false);
  _tpCb = callback; _tpChipEl = chipEl;
  const picker = document.getElementById('evdTimePicker');
  picker.innerHTML = '';
  picker.classList.remove('tp-dual');
  const [ch, cm] = (curHhmm || '09:00').split(':').map(Number);
  let selEl = null;

  if (minuteStep === 1) {
    picker.classList.add('tp-dual');
    let selH = Number.isFinite(ch) ? ch : 9;
    let selM = Number.isFinite(cm) ? cm : 0;

    const colH = document.createElement('div');
    colH.className = 'evd-tp-col';
    colH.innerHTML = '<div class="evd-tp-col-hdr">시</div>';
    const colM = document.createElement('div');
    colM.className = 'evd-tp-col';
    colM.innerHTML = '<div class="evd-tp-col-hdr">분</div>';

    const paintSel = () => {
      colH.querySelectorAll('.evd-tp-item').forEach(el => {
        el.classList.toggle('tp-sel', parseInt(el.dataset.h, 10) === selH);
      });
      colM.querySelectorAll('.evd-tp-item').forEach(el => {
        el.classList.toggle('tp-sel', parseInt(el.dataset.m, 10) === selM);
      });
    };

    for (let h = 0; h < 24; h++) {
      const hhmm = `${_p2(h)}:00`;
      const item = document.createElement('div');
      item.className = 'evd-tp-item';
      item.dataset.h = String(h);
      item.textContent = formatTimeKor(hhmm);
      if (h === selH) { item.classList.add('tp-sel'); selEl = item; }
      item.addEventListener('mousedown', ev => {
        ev.stopPropagation();
        selH = h;
        paintSel();
      });
      colH.appendChild(item);
    }

    for (let m = 0; m < 60; m++) {
      const item = document.createElement('div');
      item.className = 'evd-tp-item';
      item.dataset.m = String(m);
      item.textContent = `${m}분`;
      if (m === selM) {
        item.classList.add('tp-sel');
        if (!selEl) selEl = item;
      }
      item.addEventListener('mousedown', ev => {
        ev.stopPropagation();
        selM = m;
        const hhmm = `${_p2(selH)}:${_p2(selM)}`;
        const cb = _tpCb;
        const chip = _tpChipEl;
        closeChipTimePicker();
        if (chip) chip.classList.remove('chip-open');
        if (cb) cb(hhmm);
      });
      colM.appendChild(item);
    }

    picker.appendChild(colH);
    picker.appendChild(colM);
  } else {
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 30]) {
        const hhmm = `${_p2(h)}:${_p2(m)}`;
        const item = document.createElement('div');
        item.className = 'evd-tp-item';
        item.textContent = formatTimeKor(hhmm);
        if (h === ch && m === cm) { item.classList.add('tp-sel'); selEl = item; }
        item.addEventListener('mousedown', ev => {
          ev.stopPropagation();
          const cb = _tpCb;
          const chip = _tpChipEl;
          closeChipTimePicker();
          if (chip) chip.classList.remove('chip-open');
          if (cb) cb(hhmm);
        });
        picker.appendChild(item);
      }
    }
  }

  const r = chipEl.getBoundingClientRect();
  let top = r.bottom + 4;
  let left = r.left;
  const pickerW = minuteStep === 1 ? 200 : 152;
  const pickerH = minuteStep === 1 ? 260 : 222;
  if (left + pickerW > window.innerWidth) left = window.innerWidth - pickerW - 6;
  if (top + pickerH > window.innerHeight) top = r.top - pickerH - 4;
  picker.style.top = top + 'px';
  picker.style.left = left + 'px';
  picker.classList.add('tp-open');
  chipEl.classList.add('chip-open');
  if (selEl) setTimeout(() => selEl.scrollIntoView({ block: 'center', behavior: 'instant' }), 0);
  setTimeout(() => document.addEventListener('mousedown', _tpOutside), 0);
}
function _tpOutside(e){
  const p = document.getElementById('evdTimePicker');
  if(!p.contains(e.target) && e.target !== _tpChipEl) closeChipTimePicker();
  else setTimeout(()=> document.addEventListener('mousedown', _tpOutside, {once:true}), 0);
}
function closeChipTimePicker(){
  const p = document.getElementById('evdTimePicker');
  p.classList.remove('tp-open', 'tp-dual');
  document.removeEventListener('mousedown', _tpOutside);
  if(_tpChipEl) _tpChipEl.classList.remove('chip-open');
  _tpCb=null; _tpChipEl=null;
  // overlay 포인터 이벤트 복원
  const ov = document.getElementById('alarmMiniOverlay');
  if(ov) ov.style.pointerEvents = '';
}
/* ════════════════════════════════════════ */

function openEvDialog(year, month, day, existingEv){
  evdEditingId = existingEv?.id || null;
  _evdCalendarId = existingEv?.calendarId || resolvePrimaryCalendarId();
  const isEdit = !!existingEv;
  document.querySelector('.evd-header-title').textContent = isEdit ? '✏️ 일정 수정' : '📅 일정 추가';
  document.getElementById('evdSaveTxt').textContent = isEdit ? '💾 수정 저장' : '💾 저장';

  if(isEdit){
    const allDay  = existingEv.allDay;
    const startDT = existingEv.startDT || '';
    const endDT   = existingEv.endDT   || '';
    const dateStr = startDT.slice(0,10) || `${year}-${p(month+1)}-${p(day)}`;
    const startT  = allDay ? '09:00' : startDT.slice(11,16);
    const endT    = allDay ? '10:00' : endDT.slice(11,16);
    evdSelectedColor = colorIdToHex(existingEv.colorId);
    document.getElementById('evdTitle').value    = existingEv.title || '';
    setEvDate(dateStr);
    document.getElementById('evdAllDay').checked = allDay;
    setEvTime('evdStartTime', startT);
    setEvTime('evdEndTime', endT);
    document.getElementById('evdLocation').value = existingEv.location    || '';
    document.getElementById('evdDesc').value     = existingEv.description || '';
    document.getElementById('evdTimeRow').style.display = allDay ? 'none' : '';
  } else {
    evdSelectedColor = '#60a5fa';
    const dateStr = `${year}-${p(month+1)}-${p(day)}`;
    document.getElementById('evdTitle').value    = '';
    setEvDate(dateStr);
    document.getElementById('evdAllDay').checked = false;
    const _now = new Date();
    const _startHm = `${_p2(_now.getHours())}:${_p2(_now.getMinutes())}`;
    const _endHm   = `${_p2((_now.getHours() + 1) % 24)}:${_p2(_now.getMinutes())}`;
    setEvTime('evdStartTime', _startHm);
    setEvTime('evdEndTime',   _endHm);
    document.getElementById('evdLocation').value = '';
    document.getElementById('evdDesc').value     = '';
    document.getElementById('evdTimeRow').style.display = '';
  }

  // 알림 필드 복원
  const alarmChkEl = document.getElementById('evdAlarmChk');
  if(isEdit && calAlarms[existingEv.id]){
    alarmChkEl.checked = true;
    setEvAlarmDT(calAlarms[existingEv.id].alarmDT.slice(0,16));
    document.getElementById('evdAlarmDtWrap').style.display = '';
  } else {
    alarmChkEl.checked = false;
    document.getElementById('evdAlarmDT').value = '';
    document.getElementById('evdAlarmDtWrap').style.display = 'none';
  }

  document.getElementById('evdSaveBtn').disabled = false;
  evdBuildColors();
  document.getElementById('evDialog').classList.add('evd-open');
  setTimeout(() => document.getElementById('evdTitle').focus(), 80);
}

function closeEvDialog(){
  document.getElementById('evDialog').classList.remove('evd-open');
  closeChipDatePicker(false);
  closeChipTimePicker();
  evdEditingId = null;
  _evdCalendarId = null;
}

function evdToggleAllDay(){
  const allDay = document.getElementById('evdAllDay').checked;
  document.getElementById('evdTimeRow').style.display = allDay ? 'none' : '';
}

async function saveEvDialog(){
  const title = document.getElementById('evdTitle').value.trim();
  if(!title){ document.getElementById('evdTitle').focus(); showToast('⚠️ 제목을 입력해주세요'); return; }
  const dateStr   = document.getElementById('evdDate').value;
  const allDay    = document.getElementById('evdAllDay').checked;
  const startTime = document.getElementById('evdStartTime').value;
  const endTime   = document.getElementById('evdEndTime').value;
  const location  = document.getElementById('evdLocation').value.trim();
  const desc      = document.getElementById('evdDesc').value.trim();
  const colorEntry = EVD_COLORS.find(c => c.hex === evdSelectedColor);
  const colorId    = colorEntry?.id;

  let eTime = endTime;
  if(!allDay && endTime <= startTime){
    const [h,m] = startTime.split(':').map(Number);
    eTime = `${p(Math.min(h+1,23))}:${p(m)}`;
  }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const event = {
    summary: title,
    ...(location && { location }),
    ...(desc     && { description: desc }),
    ...(colorId  && { colorId }),
    ...(allDay
      ? { start:{ date: dateStr }, end:{ date: dateStr } }
      : { start:{ dateTime:`${dateStr}T${startTime}:00`, timeZone: tz },
          end:  { dateTime:`${dateStr}T${eTime}:00`,     timeZone: tz } }
    ),
  };

  const btn = document.getElementById('evdSaveBtn');
  const txt = document.getElementById('evdSaveTxt');
  btn.disabled = true; txt.textContent = '저장 중...';

  try {
    const calId = _evdCalendarId || resolvePrimaryCalendarId();
    const result = evdEditingId
      ? await updateCalendarEvent(evdEditingId, event, { calendarId: calId })
      : await createCalendarEvent(event, { calendarId: calId });

    if(result.error){
      showToast('❌ ' + result.error);
      btn.disabled = false;
      txt.textContent = evdEditingId ? '💾 수정 저장' : '💾 저장';
    } else {
      // 알림 저장
      const alarmChecked = document.getElementById('evdAlarmChk').checked;
      const alarmDtVal   = document.getElementById('evdAlarmDT').value;
      const savedEventId = result.id || evdEditingId;
      if(evdEditingId) delete calAlarms[evdEditingId];   // 기존 알림 제거
      if(alarmChecked && alarmDtVal && savedEventId){
        if(parseLocalDateTime(alarmDtVal) > Date.now()){
          calAlarms[savedEventId] = { alarmDT: alarmDtVal, title };
        }
      }
      saveCalAlarms();

      invalidateCalendarEventsCache(calId);
      closeEvDialog();
      showToast(evdEditingId ? '✅ 일정이 수정됐어요!' : '✅ 일정이 추가됐어요!');
      await syncAllCalendarWidgets();
      if (_activeCalendarWidgetId) renderCalForWidget(_activeCalendarWidgetId);
    }
  } catch(e){
    showToast('❌ ' + e.message);
    btn.disabled = false;
    txt.textContent = evdEditingId ? '💾 수정 저장' : '💾 저장';
  }
}

/* ════════════════════════════════════════
   캘린더 이벤트 우클릭 컨텍스트 메뉴
════════════════════════════════════════ */
var _cevCtxEvent = null;

function openCevCtx(x, y, ev){
  _cevCtxEvent = ev;
  const menu = document.getElementById('cevCtxMenu');
  const left = Math.min(x, window.innerWidth  - 158);
  const top  = Math.min(y, window.innerHeight -  88);
  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';
  menu.classList.add('cev-open');
  document.getElementById('cevCtxOverlay').classList.add('cev-open');
}

function closeCevCtx(){
  document.getElementById('cevCtxMenu').classList.remove('cev-open');
  document.getElementById('cevCtxOverlay').classList.remove('cev-open');
  _cevCtxEvent = null;
}

function cevCtxEdit(){
  const ev = _cevCtxEvent; closeCevCtx(); if(!ev) return;
  const dateStr = ev.startDT?.slice(0,10) || '';
  const [y,m,d] = dateStr ? dateStr.split('-').map(Number) : [CY, CM+1, CS];
  openEvDialog(y, m-1, d, ev);
}

async function cevCtxDelete(){
  const ev = _cevCtxEvent; closeCevCtx(); if(!ev?.id) return;
  showToast('🗑 삭제 중...');
  try {
    const calId = ev.calendarId || resolvePrimaryCalendarId();
    const result = await deleteCalendarEvent(ev.id, { calendarId: calId });
    if(result.error) showToast('❌ ' + result.error);
    else {
      // 연결된 알림도 함께 제거
      if(calAlarms[ev.id]){ delete calAlarms[ev.id]; saveCalAlarms(); }
      invalidateCalendarEventsCache(calId);
      showToast('✅ 일정이 삭제됐어요!');
      await syncAllCalendarWidgets();
      if (_activeCalendarWidgetId) renderCalForWidget(_activeCalendarWidgetId);
    }
  } catch(e){ showToast('❌ ' + e.message); }
}

/* ════════════════════════════════════════
   Google Drive 이미지 (Weekly Plan / 메모)
════════════════════════════════════════ */
var driveImgFiles = { weekly: [], memo: [] };
var driveImgIdx   = { weekly: 0,   memo: 0  };
var driveImgCache = {};

async function loadDriveImages(type, folderId){
  if (isContentSyncPaused()) return;
  if(!folderId){ showDriveEmpty(type,'폴더 ID를 설정해주세요'); return; }
  showDriveLoading(type);
  const result = await listDriveImages(folderId);
  if(result.error){ showDriveEmpty(type, result.error==='not_authenticated'?'Google 미연결':result.error); return; }
  driveImgFiles[type] = result.files||[];
  driveImgIdx[type]   = 0;
  if(!driveImgFiles[type].length){ showDriveEmpty(type,'이미지 없음'); return; }
  await showDriveImage(type, 0);
}

async function showDriveImage(type, idx){
  const files = driveImgFiles[type];
  if(!files.length) return;
  idx = Math.max(0, Math.min(idx, files.length-1));
  driveImgIdx[type] = idx;
  const fileId  = files[idx].id;
  const imgEl   = document.getElementById(`driveImg_${type}`);
  const countEl = document.getElementById(`driveCount_${type}`);
  const mockEl  = document.getElementById(`driveMock_${type}`);
  if(!imgEl) return;
  if(countEl) countEl.textContent = `${idx+1} / ${files.length}`;
  if(driveImgCache[fileId]){
    imgEl.src = driveImgCache[fileId]; imgEl.style.display='block';
    if(mockEl) mockEl.style.display='none'; return;
  }
  imgEl.style.display='none';
  if(mockEl){ mockEl.style.display='flex'; mockEl.innerHTML='<div style="font-size:22px">⏳</div><div style="font-size:12px;color:var(--text4)">로딩 중...</div>'; }
  const result = await getDriveImageData(fileId);
  if(result.error){
    if(mockEl) mockEl.innerHTML=`<div style="font-size:20px">⚠️</div><div style="font-size:11px;color:var(--text4)">${result.error}</div>`;
    return;
  }
  const dataUrl = `data:${result.mimeType};base64,${result.data}`;
  driveImgCache[fileId] = dataUrl;
  imgEl.src = dataUrl; imgEl.style.display='block';
  if(mockEl) mockEl.style.display='none';
}

function showDriveLoading(type){
  const imgEl=document.getElementById(`driveImg_${type}`), mockEl=document.getElementById(`driveMock_${type}`);
  if(imgEl) imgEl.style.display='none';
  if(mockEl){ mockEl.style.display='flex'; mockEl.innerHTML='<div style="font-size:22px">⏳</div><div style="font-size:12px;color:var(--text4)">로딩 중...</div>'; }
}

function showDriveEmpty(type, msg){
  const imgEl=document.getElementById(`driveImg_${type}`), mockEl=document.getElementById(`driveMock_${type}`);
  if(imgEl) imgEl.style.display='none';
  if(mockEl){ mockEl.style.display='flex'; mockEl.innerHTML=`<div style="font-size:22px">📁</div><div style="font-size:12px;color:var(--text4);text-align:center">${msg}</div>`; }
  const countEl=document.getElementById(`driveCount_${type}`);
  if(countEl) countEl.textContent='0 / 0';
}

function drivePrev(type){ showDriveImage(type, (driveImgIdx[type]??0)-1); }
function driveNext(type){ showDriveImage(type, (driveImgIdx[type]??0)+1); }

async function driveRefresh(type){
  driveImgCache = {};
  const id = type==='weekly'
    ? (document.getElementById('spWeeklyId')?.value?.trim()||'')
    : (document.getElementById('spMemoId')?.value?.trim()||'');
  await loadDriveImages(type, id);
}

/* ── 동기화 버튼 (실제 Google Calendar 연동) ── */
async function doSync(){
  const btn = document.getElementById('btnSync');
  if (!btn) return;
  btn.classList.add('spinning');
  showToast('🔄 동기화 중...');

  try {
    const status = await getAuthStatus();
    if (!status.authenticated) {
      showToast('⚠️ Google 계정을 먼저 연결해 주세요 (설정 → Google 탭)');
      return;
    }

    await syncAllCalendarWidgets();
    showToast('✅ 동기화 완료');
  } finally {
    btn.classList.remove('spinning');
  }
}

function launchDashboard(){
  // Setup Step2에서 입력한 폴더 ID를 메인 설정 입력란으로 이식
  const setupWId = document.getElementById('setupWeeklyInput')?.value?.trim();
  if(setupWId){
    localStorage.setItem('driveWeeklyId', setupWId);
    const spEl = document.getElementById('spWeeklyId');
    if(spEl) spEl.value = setupWId;
  }
  // 초기 설정 완료 플래그 저장
  localStorage.setItem('setupDone', '1');
  document.getElementById('setupOverlay').classList.add('hidden');
  document.getElementById('dashboard').classList.add('show');
  applyScale(userScale);
  initDashboard();
}

/** 초기 설정 화면 — onclick 외 addEventListener 백업 (모듈 지연·CSP 대비) */
function _bindSetupUiOnce() {
  const bind = (el, fn) => {
    if (!el || el.dataset.boundClick) return;
    el.dataset.boundClick = '1';
    el.addEventListener('click', (e) => { e.preventDefault(); fn(); });
  };
  bind(document.getElementById('btnNext'), () => nextSetupStep());
  bind(document.getElementById('btnBack'), () => prevSetupStep());
  bind(document.getElementById('setupConnBtn'), () => { void doSetupGoogleConnect(); });
  bind(document.querySelector('#setupOverlay .skip-txt'), () => nextSetupStep());
  document.querySelectorAll('#sp0 .res-card').forEach((el) => {
    if (el.dataset.boundClick) return;
    el.dataset.boundClick = '1';
    el.addEventListener('click', () => selRes(el));
  });
  document.querySelectorAll('#sp0 .scale-preset').forEach((el) => {
    if (el.dataset.boundClick) return;
    el.dataset.boundClick = '1';
    el.addEventListener('click', () => {
      const v = parseInt(el.querySelector('div')?.textContent || '', 10);
      if (!isNaN(v)) setScalePreset(v, el);
    });
  });
}

/* 초기 화면 핸들러 — 모듈 앞부분에서 먼저 window에 노출 */
Object.assign(window, {
  nextSetupStep, prevSetupStep, launchDashboard,
  selCat, selRes, setScalePreset, onSetupSliderInput,
  doSetupGoogleConnect, setAutoLaunch,
});

/* checkSetupDone — window 전역 노출(Object.assign) 이후 맨 아래에서 실행 */

/* ── 위젯 그리드 (단계 9: 추가/삭제 + 소스 바인딩 + 다중 인스턴스) ── */
let _widgetGridTeardown = null;
let _widgetGridState = null;
let _widgetAnchorTemplatesReady = false;
let _widgetSourceEditId = null;

function _hideWidgetEditUi(){
  const dashboard = document.getElementById('dashboard');
  if (dashboard) dashboard.classList.remove('widget-grid-editing');
  document.getElementById('widgetGridMount')?.querySelectorAll('.widget-layout-editing').forEach((el) => {
    el.classList.remove('widget-layout-editing');
  });
}

function _widgetGridMountHooks() {
  return {
    onSessionEnd: () => finishWidgetLayoutEdit(true),
    onEsc: () => finishWidgetLayoutEdit(false),
    onSettings: (id) => openWidgetSourceDialog(id),
    onDelete: (id) => deleteWidgetById(id),
  };
}

function closeTopbarMenu() {
  const overlay = document.getElementById('tbMenuOverlay');
  const btn = document.getElementById('tbMenuBtn');
  if (!overlay?.classList.contains('open')) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  if (btn) {
    btn.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
  }
}

function toggleTopbarMenu() {
  const overlay = document.getElementById('tbMenuOverlay');
  const btn = document.getElementById('tbMenuBtn');
  if (!overlay || !btn) return;
  const open = !overlay.classList.contains('open');
  overlay.classList.toggle('open', open);
  overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
  btn.classList.toggle('is-open', open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function _bindTopbarMenuOnce() {
  const btn = document.getElementById('tbMenuBtn');
  const overlay = document.getElementById('tbMenuOverlay');
  const panel = document.getElementById('tbMenuPanel');
  if (!btn || !overlay || btn.dataset.bound) return;
  btn.dataset.bound = '1';

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTopbarMenu();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeTopbarMenu();
  });

  panel?.addEventListener('click', (e) => e.stopPropagation());

  panel?.querySelectorAll('.tb-menu-item').forEach((item) => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      closeTopbarMenu();
      if (action === 'sync') void doSync();
      else if (action === 'desktop' || action === 'hide') void showDesktopPeek();
      else if (action === 'add-widget') openWidgetTypePicker();
      else if (action === 'settings') reopenSetup();
    });
  });

  if (!window.__tbMenuEscBound) {
    window.__tbMenuEscBound = true;
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeTopbarMenu();
    });
  }
}

async function finishWidgetLayoutEdit(save = true) {
  const mount = document.getElementById('widgetGridMount');
  if (!mount || !_widgetGridState || !isEditMode()) return;
  exitEditMode(mount, _widgetGridState);
  _hideWidgetEditUi();
  if (save) {
    try {
      await saveState(_widgetGridState, { immediate: true });
    } catch (e) {
      console.warn('[WidgetGrid] saveState failed:', e);
    }
  }
  initGeminiWidgetRuntimes(_widgetGridState);
  await _resumeDeferredContentSync();
}

function _ensureWidgetAnchorTemplates(){
  if (_widgetAnchorTemplatesReady) return;
  const box = document.getElementById('widgetAnchorTemplates');
  if (!box?.querySelector('[data-widget-template]')) return;
  _widgetAnchorTemplatesReady = true;
}

function _getAnchorTemplate(type){
  const box = document.getElementById('widgetAnchorTemplates');
  if (!box) return null;
  return box.querySelector(`.gc[data-widget-template="${type}"]`);
}

function _cloneCalendarAnchor(widget){
  const tpl = _getAnchorTemplate('calendar');
  if (!tpl) return null;
  const node = tpl.cloneNode(true);
  const sid = widget.id;
  node.dataset.widgetId = sid;
  node.dataset.widgetType = 'calendar';
  const titleEl = node.querySelector('.ch-title');
  if (titleEl) {
    titleEl.id = `calTitle_${sid}`;
    titleEl.textContent = widget.title || '내 캘린더';
  }
  const dates = node.querySelector('.cal-dates');
  if (dates) dates.id = `calDates_${sid}`;
  const evBox = node.querySelector('.cal-events-box');
  if (evBox) evBox.id = `calEvBox_${sid}`;
  const navBtns = node.querySelectorAll('.ch-nav .nb');
  if (navBtns[0]) navBtns[0].onclick = () => calResetForWidget(sid);
  if (navBtns[1]) navBtns[1].onclick = () => calMoveForWidget(sid, -1);
  if (navBtns[2]) navBtns[2].onclick = () => calMoveForWidget(sid, 1);
  const addNb = node.querySelector('.cal-add-nb');
  if (addNb) {
    addNb.onclick = () => {
      setActiveCalendarWidget(sid);
      const st = getCalWidgetState(sid);
      if (st) openEvDialog(st.CY, st.CM, st.CS);
    };
  }
  renderBrandIcon(node.querySelector('.ch-icon-gcal'), 'calendar', 18);
  _bindServiceIconClick(node.querySelector('.ch-icon-gcal'), openGoogleCalendar);
  _appendChGear(node.querySelector('.ch'), sid);
  node.addEventListener('mousedown', () => setActiveCalendarWidget(sid));
  return node;
}

function _cloneDriveAnchor(widget){
  const tpl = _getAnchorTemplate('drive');
  if (!tpl) return null;
  const node = tpl.cloneNode(true);
  const sid = widget.id;
  node.dataset.widgetId = sid;
  node.dataset.widgetType = 'drive';
  const titleEl = node.querySelector('.ch-title');
  if (titleEl) {
    titleEl.id = `driveTitle_${sid}`;
    titleEl.textContent = widget.title || 'Weekly Plan';
  }
  const mock = node.querySelector('.img-mock');
  if (mock) mock.id = `driveMock_${sid}`;
  const img = node.querySelector('img.drive-zoomable');
  if (img) {
    img.id = `driveImg_${sid}`;
    img.addEventListener('click', () => toggleDriveZoom(img));
  }
  const count = node.querySelector('.img-cnt');
  if (count) count.id = `driveCount_${sid}`;
  const navRow = node.querySelector('.img-nav-row');
  if (navRow) {
    const btns = navRow.querySelectorAll('.nb');
    if (btns[0]) btns[0].onclick = () => drivePrevForWidget(sid);
    if (btns[1]) btns[1].onclick = () => driveNextForWidget(sid);
  }
  const spin = node.querySelector('.nb-spin');
  if (spin) spin.onclick = () => driveRefreshForWidget(sid);
  const fileList = node.querySelector('.drive-widget-files');
  if (fileList) fileList.id = `driveFileList_${sid}`;
  renderIcon(node.querySelector('.ch-icon-wp'), WEEKLY_PLAN_ICON_MARKER, 18);
  renderWpEmptyIcon(node.querySelector('.wp-empty-icon'));
  _bindServiceIconClick(node.querySelector('.ch-icon-wp'), () => openDriveWidgetFolder(sid));
  _appendChGear(node.querySelector('.ch'), sid);
  return node;
}

function _cloneTodoAnchor(widget){
  const tpl = _getAnchorTemplate('todo');
  if (!tpl) return null;
  const node = tpl.cloneNode(true);
  const sid = widget.id;
  node.dataset.widgetId = sid;
  node.dataset.widgetType = 'todo';
  const titleEl = node.querySelector('.ch-title');
  if (titleEl) titleEl.textContent = widget.title || '메모 · 할 일';
  const list = node.querySelector('.todo-list');
  if (list) list.id = `todoList_${sid}`;
  const inp = node.querySelector('.todo-input');
  if (inp) {
    inp.id = `todoInput_${sid}`;
    inp.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addTodoItemForWidget(sid); }
    };
  }
  const addBtn = node.querySelector('.todo-add-btn');
  if (addBtn) addBtn.onclick = () => addTodoItemForWidget(sid);
  const clearBtn = node.querySelector('.ch .nb');
  if (clearBtn) clearBtn.onclick = () => clearDoneTodosForWidget(sid);
  const syncBtn = node.querySelector('.todo-sync-btn');
  if (syncBtn) syncBtn.onclick = () => syncGoogleTasks();
  renderBrandIcon(node.querySelector('.ch-icon-gtask'), 'tasks', 18);
  _bindServiceIconClick(node.querySelector('.ch-icon-gtask'), openGoogleTasks);
  _appendChGear(node.querySelector('.ch'), sid);
  return node;
}

function _cloneGWorkspaceAnchor(widget){
  const type = widget.type;
  const cfg = GWORKSPACE_WIDGET_CONFIG[type];
  if (!cfg) return null;
  const tpl = _getAnchorTemplate(type);
  if (!tpl) return null;
  const node = tpl.cloneNode(true);
  const sid = widget.id;
  node.dataset.widgetId = sid;
  node.dataset.widgetType = type;
  const titleEl = node.querySelector('.ch-title');
  if (titleEl) titleEl.textContent = widget.title || SP_WIDGET_TYPE_LABELS[type] || type;
  const list = node.querySelector('.gfile-list');
  if (list) list.id = `gfileList_${sid}`;
  const spin = node.querySelector('.nb-spin');
  if (spin) spin.onclick = () => void refreshGWorkspaceWidget(sid, type, { force: true });
  const iconEl = node.querySelector(`.${cfg.iconClass}`);
  renderBrandIcon(iconEl, cfg.brand, 18);
  _bindServiceIconClick(iconEl, () => void openExternalUrl(cfg.homeUrl));
  _appendChGear(node.querySelector('.ch'), sid);
  return node;
}

function syncCatsFromWidgetState(state){
  const cats = (state?.widgets || []).filter((w) => w.type === 'category');
  CATS.length = 0;
  cats.forEach((w) => {
    const color = w.color || '#ffb3b3';
    CATS.push({
      color,
      tc: darkenColor(color),
      name: w.title || '카테고리',
      sub: w.sub || '',
      icon: normalizeIconMarker(w.icon || '📚'),
      items: Array.isArray(w.items) ? w.items : [],
      note: w.note || '',
      type: w.catType || 'normal',
      driveRootId: w.driveRootId || '',
      _widgetId: w.id,
    });
  });
}

function syncCatsToWidgetState(state) {
  if (!state?.widgets || !Array.isArray(CATS)) return;
  const catWidgets = state.widgets.filter((w) => w.type === 'category');
  CATS.forEach((cat, idx) => {
    const w = cat._widgetId
      ? state.widgets.find((x) => x.id === cat._widgetId)
      : catWidgets[idx];
    if (!w || w.type !== 'category') return;
    w.items = Array.isArray(cat.items) ? [...cat.items] : [];
    w.title = cat.name || w.title;
    w.note = cat.note ?? '';
    w.color = cat.color ?? w.color;
    w.icon = cat.icon ?? w.icon;
    w.sub = cat.sub ?? '';
    w.driveRootId = cat.driveRootId ?? '';
    w.catType = cat.type ?? 'normal';
  });
}

let _categoryUiRefreshQueued = false;
async function refreshCategoryUi() {
  if (_categoryUiRefreshQueued) return;
  _categoryUiRefreshQueued = true;
  try {
    if (_widgetGridState) syncCatsToWidgetState(_widgetGridState);
    saveLegacyAppData();
    if (_widgetGridState) {
      try { await saveState(_widgetGridState); } catch (e) { console.warn('[refreshCategoryUi]', e); }
      await _remountWidgetGridState();
    } else {
      buildCatPanels();
    }
  } finally {
    _categoryUiRefreshQueued = false;
  }
}

const CLOCK_TIMEZONES = [
  { id: 'Asia/Seoul', label: '서울 (KST)' },
  { id: 'Asia/Tokyo', label: '도쿄 (JST)' },
  { id: 'Asia/Shanghai', label: '상하이 (CST)' },
  { id: 'Asia/Hong_Kong', label: '홍콩' },
  { id: 'Asia/Singapore', label: '싱가포르' },
  { id: 'Europe/London', label: '런던 (GMT/BST)' },
  { id: 'Europe/Paris', label: '파리 (CET)' },
  { id: 'Europe/Berlin', label: '베를린' },
  { id: 'America/New_York', label: '뉴욕 (ET)' },
  { id: 'America/Chicago', label: '시카고 (CT)' },
  { id: 'America/Los_Angeles', label: 'LA (PT)' },
  { id: 'America/Sao_Paulo', label: '상파울루' },
  { id: 'Australia/Sydney', label: '시드니' },
  { id: 'Pacific/Auckland', label: '오클랜드' },
  { id: 'UTC', label: 'UTC' },
];

let _localClockTimer = null;
let _localPomoTimer = null;
let _localWxTimer = null;
const _stickySaveTimers = new Map();
const _wxGeoResults = [];
const _gemPendingAttach = new Map();
const _gemStreamAbort = new Map();
const _gemRevealState = new Map();

function _stopGeminiReveal(widgetId) {
  const st = _gemRevealState.get(widgetId);
  if (st?.raf) cancelAnimationFrame(st.raf);
  _gemRevealState.delete(widgetId);
  document.getElementById(`gemStreaming_${widgetId}`)?.remove();
}

function _ensureGeminiStreamingBubble(widgetId) {
  const box = document.getElementById(`gemMessages_${widgetId}`);
  if (!box) return null;
  let bubble = document.getElementById(`gemStreaming_${widgetId}`);
  if (!bubble) {
    bubble = document.createElement('div');
    bubble.id = `gemStreaming_${widgetId}`;
    bubble.className = 'gem-bubble model gem-streaming';
    bubble.innerHTML = '<span class="gem-stream-text"></span><span class="gem-cursor">▍</span>';
    box.appendChild(bubble);
  }
  box.scrollTop = box.scrollHeight;
  return bubble;
}

function _scheduleGeminiReveal(widgetId, fullText) {
  const bubble = _ensureGeminiStreamingBubble(widgetId);
  const textEl = bubble?.querySelector('.gem-stream-text');
  if (!textEl) return;

  let st = _gemRevealState.get(widgetId);
  if (!st) {
    st = { shown: 0, target: '', raf: 0 };
    _gemRevealState.set(widgetId, st);
  }
  st.target = fullText || '';

  if (st.raf) return;

  const tick = () => {
    const cur = _gemRevealState.get(widgetId);
    if (!cur) return;
    const el = document.getElementById(`gemStreaming_${widgetId}`)?.querySelector('.gem-stream-text');
    if (!el) {
      cur.raf = 0;
      return;
    }
    if (cur.shown < cur.target.length) {
      cur.shown = Math.min(cur.shown + 2, cur.target.length);
      el.textContent = cur.target.slice(0, cur.shown);
      const box = document.getElementById(`gemMessages_${widgetId}`);
      if (box) box.scrollTop = box.scrollHeight;
      cur.raf = requestAnimationFrame(tick);
    } else {
      cur.raf = 0;
    }
  };
  st.raf = requestAnimationFrame(tick);
}

function _stopPointerOnLocalInput(el) {
  if (!el) return;
  el.addEventListener('mousedown', (e) => e.stopPropagation());
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
}

function createLocalWidgetNode(widget){
  const sid = widget.id;
  const node = document.createElement('div');
  node.className = 'gc local-widget';
  node.dataset.widgetId = sid;
  node.dataset.widgetType = widget.type;
  node.style.display = 'flex';
  node.style.flexDirection = 'column';

  const ch = document.createElement('div');
  ch.className = 'ch';
  const icons = { clock: '🕐', sticky: '📌', pomodoro: '⏱', dday: '📆', weather: '☀️' };
  const chIcon = document.createElement('span');
  chIcon.className = 'ch-icon';
  chIcon.textContent = icons[widget.type] || '◻';
  const chTitle = document.createElement('span');
  chTitle.className = 'ch-title';
  chTitle.textContent = widget.title || '';
  ch.appendChild(chIcon);
  ch.appendChild(chTitle);
  _appendChGear(ch, sid);
  node.appendChild(ch);

  if (widget.type === 'clock') {
    const body = document.createElement('div');
    body.className = 'local-clock-body';
    const disp = document.createElement('div');
    disp.className = 'local-clock-display';
    disp.id = `localClock_${sid}`;
    body.appendChild(disp);
    node.appendChild(body);
  } else if (widget.type === 'sticky') {
    const ta = document.createElement('textarea');
    ta.className = 'local-sticky-text';
    ta.id = `localSticky_${sid}`;
    ta.placeholder = '메모를 입력하세요...';
    ta.maxLength = 2000;
    _stopPointerOnLocalInput(ta);
    node.appendChild(ta);
  } else if (widget.type === 'pomodoro') {
    const body = document.createElement('div');
    body.className = 'local-pomo-body';
    const timeEl = document.createElement('div');
    timeEl.className = 'local-pomo-time';
    timeEl.id = `localPomoTime_${sid}`;
    const phaseEl = document.createElement('div');
    phaseEl.className = 'local-pomo-phase';
    phaseEl.id = `localPomoPhase_${sid}`;
    const btns = document.createElement('div');
    btns.className = 'local-pomo-btns';
    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'nb';
    startBtn.id = `localPomoStart_${sid}`;
    startBtn.textContent = '시작';
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'nb';
    resetBtn.id = `localPomoReset_${sid}`;
    resetBtn.textContent = '리셋';
    _stopPointerOnLocalInput(startBtn);
    _stopPointerOnLocalInput(resetBtn);
    btns.appendChild(startBtn);
    btns.appendChild(resetBtn);
    body.appendChild(timeEl);
    body.appendChild(phaseEl);
    body.appendChild(btns);
    node.appendChild(body);
  } else if (widget.type === 'dday') {
    const body = document.createElement('div');
    body.className = 'local-dday-body';
    const numEl = document.createElement('div');
    numEl.className = 'local-dday-num';
    numEl.id = `localDdayNum_${sid}`;
    const lblEl = document.createElement('div');
    lblEl.className = 'local-dday-label';
    lblEl.id = `localDdayLabel_${sid}`;
    body.appendChild(numEl);
    body.appendChild(lblEl);
    node.appendChild(body);
  } else if (widget.type === 'weather') {
    const body = document.createElement('div');
    body.className = 'local-weather-body';
    const current = document.createElement('div');
    current.className = 'local-wx-current';
    const iconEl = document.createElement('span');
    iconEl.className = 'local-wx-icon';
    iconEl.id = `localWxIcon_${sid}`;
    iconEl.textContent = '🌡️';
    const meta = document.createElement('div');
    meta.className = 'local-wx-meta';
    const tempEl = document.createElement('div');
    tempEl.className = 'local-wx-temp';
    tempEl.id = `localWxTemp_${sid}`;
    tempEl.textContent = '—';
    const labelEl = document.createElement('div');
    labelEl.className = 'local-wx-label';
    labelEl.id = `localWxLabel_${sid}`;
    labelEl.textContent = '불러오는 중…';
    const placeEl = document.createElement('div');
    placeEl.className = 'local-wx-place';
    placeEl.id = `localWxPlace_${sid}`;
    placeEl.textContent = widget.config?.placeName || widget.config?.loc || '';
    meta.appendChild(tempEl);
    meta.appendChild(labelEl);
    meta.appendChild(placeEl);
    current.appendChild(iconEl);
    current.appendChild(meta);
    const dailyEl = document.createElement('div');
    dailyEl.className = 'local-wx-daily';
    dailyEl.id = `localWxDaily_${sid}`;
    body.appendChild(current);
    body.appendChild(dailyEl);
    node.appendChild(body);
  }
  return node;
}

function renderClockWidget(w){
  const el = document.getElementById(`localClock_${w.id}`);
  if (!el) return;
  const tz = w.config?.tz || 'Asia/Seoul';
  const fmt24 = w.config?.format24 !== false;
  try {
    const now = new Date();
    const dateFmt = new Intl.DateTimeFormat('ko-KR', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    });
    const timeFmt = new Intl.DateTimeFormat('ko-KR', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: !fmt24,
    });
    el.innerHTML = `<div class="local-clock-date">${dateFmt.format(now)}</div>`
      + `<div class="local-clock-time">${timeFmt.format(now)}</div>`;
  } catch {
    el.textContent = '잘못된 타임존';
  }
}

function renderDdayWidget(w){
  const numEl = document.getElementById(`localDdayNum_${w.id}`);
  const lblEl = document.getElementById(`localDdayLabel_${w.id}`);
  if (!numEl || !lblEl) return;
  const days = computeDday(w.config?.date || '');
  if (days === null) {
    numEl.textContent = '—';
  } else if (days === 0) {
    numEl.textContent = 'D-Day';
  } else if (days > 0) {
    numEl.textContent = `D-${days}`;
  } else {
    numEl.textContent = `D+${Math.abs(days)}`;
  }
  lblEl.textContent = w.config?.label || w.title || 'D-Day';
}

function _pomoRemainingSec(w){
  const cfg = w.config || {};
  if (cfg.phase === 'idle' || !cfg.endsAt) {
    return (cfg.workMin ?? 25) * 60;
  }
  return Math.max(0, Math.ceil((cfg.endsAt - Date.now()) / 1000));
}

function renderPomodoroWidget(w){
  const timeEl = document.getElementById(`localPomoTime_${w.id}`);
  const phaseEl = document.getElementById(`localPomoPhase_${w.id}`);
  const startBtn = document.getElementById(`localPomoStart_${w.id}`);
  if (!timeEl || !phaseEl) return;
  const cfg = w.config || {};
  const phase = cfg.phase || 'idle';
  const remain = _pomoRemainingSec(w);
  timeEl.textContent = formatPomoTime(remain);
  const phaseLabels = { idle: '대기', work: '집중', break: '휴식' };
  phaseEl.textContent = phaseLabels[phase] || '대기';
  if (startBtn) {
    startBtn.textContent = phase === 'idle' ? '시작' : '일시정지';
  }
}

function _ensurePomoTimer(){
  if (_localPomoTimer) return;
  _localPomoTimer = setInterval(() => {
    tickAllPomodoros();
  }, 1000);
}

function _stopPomoTimerIfIdle(){
  const active = (_widgetGridState?.widgets || []).some(
    (w) => w.type === 'pomodoro' && w.config?.phase && w.config.phase !== 'idle' && w.config.endsAt,
  );
  if (!active && _localPomoTimer) {
    clearInterval(_localPomoTimer);
    _localPomoTimer = null;
  }
}

function tickAllPomodoros(){
  if (!_widgetGridState?.widgets) return;
  let changed = false;
  for (const w of _widgetGridState.widgets.filter((x) => x.type === 'pomodoro')) {
    const cfg = w.config || {};
    if (cfg.phase === 'idle' || !cfg.endsAt) continue;
    if (Date.now() < cfg.endsAt) {
      renderPomodoroWidget(w);
      continue;
    }
    if (cfg.phase === 'work') {
      showToast('⏱ 집중 시간 완료! 휴식하세요');
      queueAlarmNotif({ type: 'pomo', label: '집중 완료', dt: new Date().toISOString() });
      cfg.phase = 'break';
      cfg.endsAt = Date.now() + (cfg.breakMin ?? 5) * 60_000;
    } else if (cfg.phase === 'break') {
      showToast('✅ 휴식 완료!');
      cfg.phase = 'idle';
      cfg.endsAt = null;
    }
    renderPomodoroWidget(w);
    changed = true;
  }
  if (changed && _widgetGridState) void saveState(_widgetGridState);
  _stopPomoTimerIfIdle();
}

function startPomodoroWidget(widgetId){
  const w = _widgetGridState?.widgets?.find((x) => x.id === widgetId);
  if (!w || w.type !== 'pomodoro') return;
  if (!w.config) w.config = {};
  const cfg = w.config;
  if (cfg.phase === 'idle') {
    cfg.phase = 'work';
    cfg.endsAt = Date.now() + (cfg.workMin ?? 25) * 60_000;
  } else {
    cfg.phase = 'idle';
    cfg.endsAt = null;
  }
  renderPomodoroWidget(w);
  _ensurePomoTimer();
  void saveState(_widgetGridState);
}

function resetPomodoroWidget(widgetId){
  const w = _widgetGridState?.widgets?.find((x) => x.id === widgetId);
  if (!w || w.type !== 'pomodoro') return;
  if (!w.config) w.config = {};
  w.config.phase = 'idle';
  w.config.endsAt = null;
  renderPomodoroWidget(w);
  void saveState(_widgetGridState);
  _stopPomoTimerIfIdle();
}

function bindStickyWidget(w){
  const ta = document.getElementById(`localSticky_${w.id}`);
  if (!ta) return;
  ta.value = w.text || '';
  ta.oninput = () => {
    w.text = ta.value;
    const prev = _stickySaveTimers.get(w.id);
    if (prev) clearTimeout(prev);
    _stickySaveTimers.set(w.id, setTimeout(() => {
      _stickySaveTimers.delete(w.id);
      if (_widgetGridState) void saveState(_widgetGridState);
    }, 300));
  };
}

function bindPomodoroWidget(w){
  const startBtn = document.getElementById(`localPomoStart_${w.id}`);
  const resetBtn = document.getElementById(`localPomoReset_${w.id}`);
  if (startBtn) startBtn.onclick = (e) => { e.stopPropagation(); startPomodoroWidget(w.id); };
  if (resetBtn) resetBtn.onclick = (e) => { e.stopPropagation(); resetPomodoroWidget(w.id); };
  renderPomodoroWidget(w);
  if (w.config?.phase && w.config.phase !== 'idle' && w.config.endsAt) _ensurePomoTimer();
}

function _formatWxWeekday(dateStr){
  if (!dateStr) return '—';
  try {
    const d = new Date(`${dateStr}T12:00:00`);
    return new Intl.DateTimeFormat('ko-KR', { weekday: 'short' }).format(d);
  } catch {
    return dateStr.slice(5);
  }
}

function renderWeatherWidget(w, data){
  const unit = w.config?.unit === 'f' ? 'f' : 'c';
  const tempEl = document.getElementById(`localWxTemp_${w.id}`);
  const labelEl = document.getElementById(`localWxLabel_${w.id}`);
  const placeEl = document.getElementById(`localWxPlace_${w.id}`);
  const iconEl = document.getElementById(`localWxIcon_${w.id}`);
  const dailyEl = document.getElementById(`localWxDaily_${w.id}`);
  if (!tempEl || !labelEl || !dailyEl) return;
  if (!data || data.error) {
    tempEl.textContent = '—';
    labelEl.textContent = data?.error || '데이터 없음';
    if (placeEl) placeEl.textContent = w.config?.placeName || w.config?.loc || '';
    if (iconEl) iconEl.textContent = '🌡️';
    dailyEl.innerHTML = '';
    return;
  }
  const cur = data.current || {};
  if (iconEl) iconEl.textContent = weatherCodeIcon(cur.code);
  tempEl.textContent = formatTemperature(cur.temp, unit);
  labelEl.textContent = weatherCodeLabel(cur.code);
  if (placeEl) placeEl.textContent = w.config?.placeName || w.config?.loc || '';
  const rows = (data.daily || []).slice(0, 5).map((day) => {
    const icon = weatherCodeIcon(day.code);
    const max = formatTemperature(day.max, unit);
    const min = formatTemperature(day.min, unit);
    return `<div class="local-wx-daily-row">`
      + `<span class="local-wx-day">${_formatWxWeekday(day.date)}</span>`
      + `<span class="local-wx-daily-icon">${icon}</span>`
      + `<span class="local-wx-range">${max} / ${min}</span>`
      + `</div>`;
  }).join('');
  dailyEl.innerHTML = rows;
}

async function fetchWeatherForWidget(widgetId, { forceToast = false } = {}){
  if (isContentSyncPaused()) return;
  const w = _widgetGridState?.widgets?.find((x) => x.id === widgetId);
  if (!w || w.type !== 'weather') return;
  const cfg = w.config || {};
  const lat = cfg.latitude;
  const lon = cfg.longitude;
  const unit = cfg.unit === 'f' ? 'f' : 'c';
  if (lat == null || lon == null) {
    renderWeatherWidget(w, { error: '좌표 없음' });
    return;
  }
  const key = buildWeatherForecastKey(lat, lon, unit);
  const data = await fetchCached(
    _wxCache,
    key,
    DEFAULT_WEATHER_TTL_MS,
    () => fetchWeatherForecast({ latitude: lat, longitude: lon, unit }),
  );
  renderWeatherWidget(w, data);
  if (data?.error && forceToast) showToast(`☁️ 날씨: ${data.error}`);
}

async function fetchAllWeatherWidgets({ forceToast = false } = {}){
  const widgets = (_widgetGridState?.widgets || []).filter((x) => x.type === 'weather');
  await Promise.all(widgets.map((w) => fetchWeatherForWidget(w.id, { forceToast })));
}

function _ensureWxTimer(){
  if (_localWxTimer) return;
  _localWxTimer = setInterval(() => {
    if (isContentSyncPaused()) return;
    void fetchAllWeatherWidgets();
  }, DEFAULT_WEATHER_TTL_MS);
}

function _stopWxTimerIfNone(){
  const hasWx = (_widgetGridState?.widgets || []).some((w) => w.type === 'weather');
  if (!hasWx && _localWxTimer) {
    clearInterval(_localWxTimer);
    _localWxTimer = null;
  }
}

function _populateWeatherPlaceSelect(sel, places, selectedLat, selectedLon){
  if (!sel) return;
  sel.innerHTML = '';
  for (const p of places) {
    const opt = document.createElement('option');
    opt.value = `${p.lat},${p.lon}`;
    opt.textContent = p.label || p.name;
    opt.dataset.name = p.name;
    opt.dataset.lat = String(p.lat);
    opt.dataset.lon = String(p.lon);
    sel.appendChild(opt);
  }
  if (selectedLat != null && selectedLon != null) {
    const match = `${selectedLat},${selectedLon}`;
    const found = [...sel.options].find((o) => o.value === match);
    if (found) sel.value = match;
    else if (sel.options.length) sel.selectedIndex = 0;
  } else if (sel.options.length) {
    sel.selectedIndex = 0;
  }
}

async function searchWeatherLocation(){
  const inp = document.getElementById('wsfWeatherLoc');
  const sel = document.getElementById('wsfWeatherPlace');
  const q = inp?.value?.trim();
  if (!q) {
    showToast('위치 이름을 입력하세요');
    return;
  }
  if (sel) sel.innerHTML = '<option>검색 중…</option>';
  const res = await fetchCached(
    _wxCache,
    buildGeocodeKey(q),
    DEFAULT_GEOCODE_TTL_MS,
    () => geocodeLocation(q),
  );
  _wxGeoResults.length = 0;
  if (res.error) {
    if (sel) sel.innerHTML = `<option value="">${res.error}</option>`;
    showToast(`☁️ ${res.error}`);
    return;
  }
  _wxGeoResults.push(...(res.places || []));
  _populateWeatherPlaceSelect(sel, _wxGeoResults);
}

function stopLocalWidgetTimers(){
  if (_localClockTimer) { clearInterval(_localClockTimer); _localClockTimer = null; }
  if (_localPomoTimer) { clearInterval(_localPomoTimer); _localPomoTimer = null; }
  if (_localWxTimer) { clearInterval(_localWxTimer); _localWxTimer = null; }
  for (const t of _stickySaveTimers.values()) clearTimeout(t);
  _stickySaveTimers.clear();
}

function initLocalWidgetRuntimes(state){
  stopLocalWidgetTimers();
  const widgets = state?.widgets || [];
  for (const w of widgets) {
    if (w.type === 'clock') renderClockWidget(w);
    else if (w.type === 'sticky') bindStickyWidget(w);
    else if (w.type === 'pomodoro') bindPomodoroWidget(w);
    else if (w.type === 'dday') renderDdayWidget(w);
    else if (w.type === 'weather') renderWeatherWidget(w, null);
  }
  if (widgets.some((w) => w.type === 'clock')) {
    _localClockTimer = setInterval(() => {
      for (const w of (_widgetGridState?.widgets || []).filter((x) => x.type === 'clock')) {
        renderClockWidget(w);
      }
    }, 1000);
  }
  if (widgets.some((w) => w.type === 'pomodoro' && w.config?.phase !== 'idle' && w.config?.endsAt)) {
    _ensurePomoTimer();
  }
  if (widgets.some((w) => w.type === 'weather')) {
    void fetchAllWeatherWidgets({ forceToast: true });
    _ensureWxTimer();
  }
}

function _stopPointerOnGeminiInput(el) {
  if (!el) return;
  const stop = (e) => e.stopPropagation();
  el.addEventListener('mousedown', stop);
  el.addEventListener('pointerdown', stop);
  el.addEventListener('click', stop);
  el.addEventListener('focusin', stop);
}

function _getGeminiApiKey() {
  return _widgetGridState?.secrets?.geminiApiKey?.trim() || '';
}

function _populateGeminiModelSelect(sel, selected) {
  if (!sel) return;
  sel.innerHTML = '';
  for (const m of GEMINI_MODELS) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    sel.appendChild(opt);
  }
  sel.value = selected || DEFAULT_GEMINI_MODEL;
}

function openGeminiKeyGuideModal() {
  document.getElementById('geminiKeyGuideDialog')?.classList.add('open');
}

function closeGeminiKeyGuideModal() {
  document.getElementById('geminiKeyGuideDialog')?.classList.remove('open');
}

function createGeminiWidgetNode(widget) {
  const sid = widget.id;
  const node = document.createElement('div');
  node.className = 'gc gemini-widget';
  node.dataset.widgetId = sid;
  node.dataset.widgetType = 'gemini';
  node.style.display = 'flex';
  node.style.flexDirection = 'column';

  const ch = document.createElement('div');
  ch.className = 'ch';
  const chIcon = document.createElement('span');
  chIcon.className = 'ch-icon ch-icon-gemini';
  renderBrandIcon(chIcon, 'gemini', 18);
  const chTitle = document.createElement('span');
  chTitle.className = 'ch-title';
  chTitle.textContent = widget.title || 'Gemini';
  const badge = document.createElement('span');
  badge.className = 'gem-model-badge';
  badge.id = `gemModelBadge_${sid}`;
  badge.textContent = widget.config?.model || DEFAULT_GEMINI_MODEL;
  ch.appendChild(chIcon);
  ch.appendChild(chTitle);
  ch.appendChild(badge);
  _appendChGear(ch, sid);
  node.appendChild(ch);

  const body = document.createElement('div');
  body.className = 'gem-body';

  const sidebar = document.createElement('div');
  sidebar.className = 'gem-sidebar';
  sidebar.id = `gemSidebar_${sid}`;
  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'gem-new-chat';
  newBtn.id = `gemNewChat_${sid}`;
  newBtn.textContent = '+ 새 대화';
  const chatList = document.createElement('div');
  chatList.className = 'gem-chat-list';
  chatList.id = `gemChatList_${sid}`;
  sidebar.appendChild(newBtn);
  sidebar.appendChild(chatList);

  const main = document.createElement('div');
  main.className = 'gem-main';
  const messages = document.createElement('div');
  messages.className = 'gem-messages';
  messages.id = `gemMessages_${sid}`;
  const streamEl = document.createElement('div');
  streamEl.className = 'gem-stream';
  streamEl.id = `gemStream_${sid}`;
  const attachPreview = document.createElement('div');
  attachPreview.className = 'gem-attach-preview';
  attachPreview.id = `gemAttach_${sid}`;
  const inputRow = document.createElement('div');
  inputRow.className = 'gem-input-row';
  const attachBtn = document.createElement('button');
  attachBtn.type = 'button';
  attachBtn.className = 'gem-attach-btn';
  attachBtn.id = `gemAttachBtn_${sid}`;
  attachBtn.textContent = '📎';
  const textarea = document.createElement('textarea');
  textarea.id = `gemInput_${sid}`;
  textarea.placeholder = '메시지를 입력하세요…';
  textarea.rows = 1;
  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'gem-send-btn';
  sendBtn.id = `gemSend_${sid}`;
  sendBtn.textContent = '전송';
  _stopPointerOnGeminiInput(textarea);
  _stopPointerOnGeminiInput(attachBtn);
  _stopPointerOnGeminiInput(sendBtn);
  inputRow.appendChild(attachBtn);
  inputRow.appendChild(textarea);
  inputRow.appendChild(sendBtn);
  main.appendChild(messages);
  main.appendChild(streamEl);
  main.appendChild(attachPreview);
  main.appendChild(inputRow);
  body.appendChild(sidebar);
  body.appendChild(main);
  node.appendChild(body);
  return node;
}

function _escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderGeminiChatList(widgetId) {
  const listEl = document.getElementById(`gemChatList_${widgetId}`);
  const widget = _widgetGridState?.widgets?.find((w) => w.id === widgetId);
  if (!listEl || !widget) return;
  const chats = listGeminiChatsForWidget(_widgetGridState, widgetId);
  const activeId = widget.config?.activeChatId;
  listEl.innerHTML = '';
  for (const c of chats) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `gem-chat-item${c.id === activeId ? ' is-active' : ''}`;
    btn.textContent = c.title || '새 대화';
    btn.dataset.chatId = c.id;
    btn.onclick = (e) => {
      e.stopPropagation();
      void selectGeminiChat(widgetId, c.id);
    };
    listEl.appendChild(btn);
  }
}

function renderGeminiMessages(widgetId) {
  const box = document.getElementById(`gemMessages_${widgetId}`);
  const widget = _widgetGridState?.widgets?.find((w) => w.id === widgetId);
  if (!box || !widget) return;
  const apiKey = _getGeminiApiKey();
  if (!apiKey) {
    box.innerHTML = '<div class="gem-bubble system">API 키가 없습니다. 설정 → 위젯에서 Gemini를 선택해 키를 입력하거나 '
      + '<button type="button" class="gem-new-chat" id="gemInlineKeyGuide">무료 키 발급 방법</button>을 확인하세요.</div>';
    document.getElementById('gemInlineKeyGuide')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openGeminiKeyGuideModal();
    });
    return;
  }
  const chatId = widget.config?.activeChatId;
  const chat = chatId ? getGeminiChat(_widgetGridState, chatId) : null;
  if (!chat || !chat.messages?.length) {
    box.innerHTML = '<div class="gem-bubble system">새 대화를 시작하세요. 📎로 파일을 첨부할 수 있습니다.</div>';
    return;
  }
  box.innerHTML = chat.messages.map((m) => {
    const role = m.role === 'model' ? 'model' : (m.role === 'user' ? 'user' : 'system');
    let extra = '';
    if (m.attachments?.length) {
      extra = `<div style="font-size:10px;color:var(--text3);margin-top:4px">${m.attachments.map((a) => `📎 ${a.name}`).join(', ')}</div>`;
    }
    return `<div class="gem-bubble ${role}">${_escapeHtml(m.text || '')}${extra}</div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

function renderGeminiAttachPreview(widgetId) {
  const el = document.getElementById(`gemAttach_${widgetId}`);
  const pending = _gemPendingAttach.get(widgetId) || [];
  if (!el) return;
  if (!pending.length) { el.innerHTML = ''; return; }
  el.innerHTML = pending.map((p) => `<span class="gem-attach-chip">📎 ${p.name}</span>`).join('');
}

function _setGeminiStreaming(widgetId, streaming) {
  const sendBtn = document.getElementById(`gemSend_${widgetId}`);
  const attachBtn = document.getElementById(`gemAttachBtn_${widgetId}`);
  const input = document.getElementById(`gemInput_${widgetId}`);
  if (sendBtn) sendBtn.disabled = !!streaming;
  if (attachBtn) attachBtn.disabled = !!streaming;
  if (input) input.disabled = !!streaming;
}

async function selectGeminiChat(widgetId, chatId) {
  if (!_widgetGridState) return;
  _widgetGridState = setActiveGeminiChat(_widgetGridState, widgetId, chatId);
  renderGeminiChatList(widgetId);
  renderGeminiMessages(widgetId);
  await saveState(_widgetGridState);
}

async function newGeminiChat(widgetId) {
  if (!_widgetGridState) return;
  _widgetGridState = createGeminiChat(_widgetGridState, widgetId);
  renderGeminiChatList(widgetId);
  renderGeminiMessages(widgetId);
  _setGeminiStreaming(widgetId, false);
  const input = document.getElementById(`gemInput_${widgetId}`);
  if (input) {
    input.disabled = false;
    input.focus();
  }
  await saveState(_widgetGridState);
}

let _gemFilePickWidgetId = null;

function _bytesToUint8Array(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (Array.isArray(bytes)) return Uint8Array.from(bytes);
  if (bytes?.buffer instanceof ArrayBuffer) return new Uint8Array(bytes.buffer);
  return new Uint8Array(bytes || []);
}

function _ensureGemFileInput() {
  let inp = document.getElementById('gemFileInput');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id = 'gemFileInput';
    inp.style.display = 'none';
    inp.accept = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.docx,.xlsx,.xls';
    inp.addEventListener('change', () => {
      const file = inp.files?.[0];
      const wid = _gemFilePickWidgetId;
      inp.value = '';
      _gemFilePickWidgetId = null;
      if (file && wid) void _processAttachmentBlob(file, wid);
    });
    document.body.appendChild(inp);
  }
  return inp;
}

async function _processAttachmentBytes(u8, fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.hwp') || lower.endsWith('.hwpx')) {
    return { error: 'HWP/HWPX는 지원 예정입니다' };
  }
  const size = u8.byteLength;

  if (lower.endsWith('.docx')) {
    const res = await extractDocxText(u8.buffer);
    if (res.error) return res;
    return {
      name: fileName, mime: 'text/plain', kind: 'docx',
      parts: [{ text: `[첨부: ${fileName}]\n${res.text}` }],
    };
  }
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const res = await extractXlsxText(u8.buffer);
    if (res.error) return res;
    return {
      name: fileName, mime: 'text/plain', kind: 'xlsx',
      parts: [{ text: `[첨부: ${fileName}]\n${res.text}` }],
    };
  }

  let mime = 'application/octet-stream';
  if (lower.endsWith('.png')) mime = 'image/png';
  else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mime = 'image/jpeg';
  else if (lower.endsWith('.gif')) mime = 'image/gif';
  else if (lower.endsWith('.webp')) mime = 'image/webp';
  else if (lower.endsWith('.pdf')) mime = 'application/pdf';
  else if (lower.endsWith('.txt') || lower.endsWith('.md')) mime = 'text/plain';

  const apiKey = _getGeminiApiKey();
  if (size > LARGE_FILE_BYTES) {
    const up = await uploadLargeFile({ apiKey, bytes: u8, mime, displayName: fileName });
    if (up.error) return up;
    return {
      name: fileName, mime: up.mimeType || mime, kind: 'file',
      parts: [readFileUriPart(up.uri, up.mimeType || mime)],
    };
  }

  const b64 = arrayBufferToBase64(u8.buffer);
  if (mime.startsWith('text/')) {
    try {
      const text = new TextDecoder().decode(u8);
      return {
        name: fileName, mime, kind: 'text',
        parts: [{ text: `[첨부: ${fileName}]\n${text}` }],
      };
    } catch {
      // fall through to base64
    }
  }
  return {
    name: fileName, mime, kind: 'inline',
    parts: [readFileAsBase64Part(mime, b64)],
  };
}

async function _processAttachmentFile(filePath, fileName) {
  let bytes;
  try {
    bytes = await tInvoke('plugin:fs|read_file', { path: filePath });
  } catch (e) {
    return { error: e?.message || '파일 읽기 실패' };
  }
  return _processAttachmentBytes(_bytesToUint8Array(bytes), fileName);
}

async function _processAttachmentBlob(file, widgetId) {
  try {
    const u8 = new Uint8Array(await file.arrayBuffer());
    const processed = await _processAttachmentBytes(u8, file.name || 'file');
    if (processed.error) {
      showToast(`📎 ${processed.error}`);
      return;
    }
    _pushGeminiAttachment(widgetId, processed);
  } catch (e) {
    showToast(`📎 첨부 실패: ${e?.message || '오류'}`);
  }
}

function _pushGeminiAttachment(widgetId, processed) {
  const list = _gemPendingAttach.get(widgetId) || [];
  list.push(processed);
  _gemPendingAttach.set(widgetId, list);
  renderGeminiAttachPreview(widgetId);
}

async function pickGeminiAttachment(widgetId) {
  if (!window.__TAURI__) {
    _gemFilePickWidgetId = widgetId;
    _ensureGemFileInput().click();
    return;
  }
  try {
    const picked = await tDialogOpen({
      multiple: false,
      title: '첨부 파일 선택',
      filters: [{
        name: '지원 파일',
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'md', 'docx', 'xlsx', 'xls'],
      }],
    });
    if (!picked) return;
    const filePath = Array.isArray(picked) ? picked[0] : picked;
    if (!filePath) return;
    const fileName = String(filePath).split(/[\\/]/).pop() || 'file';
    const processed = await _processAttachmentFile(filePath, fileName);
    if (processed.error) {
      showToast(`📎 ${processed.error}`);
      return;
    }
    _pushGeminiAttachment(widgetId, processed);
  } catch (e) {
    console.warn('[Gemini] dialog pick failed, using file input fallback:', e);
    _gemFilePickWidgetId = widgetId;
    _ensureGemFileInput().click();
  }
}

async function sendGeminiMessage(widgetId) {
  if (!_widgetGridState) return;
  const apiKey = _getGeminiApiKey();
  if (!apiKey) {
    showToast('🤖 API 키를 먼저 설정하세요');
    openGeminiKeyGuideModal();
    return;
  }
  const widget = _widgetGridState.widgets.find((w) => w.id === widgetId);
  if (!widget) return;
  const input = document.getElementById(`gemInput_${widgetId}`);
  const streamEl = document.getElementById(`gemStream_${widgetId}`);
  const text = input?.value?.trim() || '';
  const pending = _gemPendingAttach.get(widgetId) || [];
  if (!text && !pending.length) return;

  let chatId = widget.config?.activeChatId;
  if (!chatId) {
    _widgetGridState = createGeminiChat(_widgetGridState, widgetId);
    chatId = _widgetGridState.widgets.find((w) => w.id === widgetId)?.config?.activeChatId;
  }
  if (!chatId) return;

  const attachMeta = pending.map((p) => ({ name: p.name, mime: p.mime, kind: p.kind }));
  const attachParts = pending.flatMap((p) => p.parts || []);
  const userMsg = { role: 'user', text: text || '(첨부 파일)', attachments: attachMeta };
  _widgetGridState = appendGeminiMessage(_widgetGridState, chatId, userMsg);
  if (input) input.value = '';
  _gemPendingAttach.set(widgetId, []);
  renderGeminiAttachPreview(widgetId);
  renderGeminiMessages(widgetId);
  renderGeminiChatList(widgetId);

  const chat = getGeminiChat(_widgetGridState, chatId);
  const model = widget.config?.model || DEFAULT_GEMINI_MODEL;
  const messages = (chat?.messages || []).filter((m) => m.role === 'user' || m.role === 'model');

  _setGeminiStreaming(widgetId, true);
  if (streamEl) streamEl.textContent = '응답 생성 중…';
  _ensureGeminiStreamingBubble(widgetId);
  const abort = new AbortController();
  _gemStreamAbort.set(widgetId, abort);

  const result = await streamGenerateContent({
    apiKey,
    model,
    messages,
    attachmentParts: attachParts,
    onChunk: (full) => {
      _scheduleGeminiReveal(widgetId, full);
      if (streamEl) streamEl.textContent = '응답 생성 중…';
    },
    signal: abort.signal,
  });

  _gemStreamAbort.delete(widgetId);
  _setGeminiStreaming(widgetId, false);
  if (streamEl) streamEl.textContent = '';
  _stopGeminiReveal(widgetId);

  if (result.aborted) return;
  if (result.error) {
    showToast(`🤖 ${result.error}`);
    if (input && text) input.value = text;
    return;
  }

  _widgetGridState = appendGeminiMessage(_widgetGridState, chatId, {
    role: 'model', text: result.text || '(응답 없음)',
  });
  renderGeminiMessages(widgetId);
  await saveState(_widgetGridState);

  const updated = getGeminiChat(_widgetGridState, chatId);
  const userCount = (updated?.messages || []).filter((m) => m.role === 'user').length;
  if (userCount === 1 && text) {
    void generateTitle({ apiKey, model, firstUserText: text }).then(async (t) => {
      if (!_widgetGridState || !t?.title) return;
      _widgetGridState = updateGeminiChatTitle(_widgetGridState, chatId, t.title);
      renderGeminiChatList(widgetId);
      await saveState(_widgetGridState);
    });
  }
}

function bindGeminiWidget(widget) {
  const sid = widget.id;
  const newBtn = document.getElementById(`gemNewChat_${sid}`);
  const sendBtn = document.getElementById(`gemSend_${sid}`);
  const attachBtn = document.getElementById(`gemAttachBtn_${sid}`);
  const input = document.getElementById(`gemInput_${sid}`);
  const badge = document.getElementById(`gemModelBadge_${sid}`);
  if (badge) badge.textContent = widget.config?.model || DEFAULT_GEMINI_MODEL;
  if (newBtn) newBtn.onclick = (e) => { e.stopPropagation(); void newGeminiChat(sid); };
  if (sendBtn) sendBtn.onclick = (e) => { e.stopPropagation(); void sendGeminiMessage(sid); };
  if (attachBtn) attachBtn.onclick = (e) => { e.stopPropagation(); void pickGeminiAttachment(sid); };
  if (input) {
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void sendGeminiMessage(sid);
      }
    };
  }
  _setGeminiStreaming(sid, false);
  renderGeminiChatList(sid);
  renderGeminiMessages(sid);
  renderGeminiAttachPreview(sid);
}

function initGeminiWidgetRuntimes(state) {
  for (const w of (state?.widgets || []).filter((x) => x.type === 'gemini')) {
    bindGeminiWidget(w);
  }
}

function _populateClockTzSelect(sel, selected){
  if (!sel) return;
  sel.innerHTML = '';
  for (const z of CLOCK_TIMEZONES) {
    const opt = document.createElement('option');
    opt.value = z.id;
    opt.textContent = z.label;
    sel.appendChild(opt);
  }
  sel.value = selected || 'Asia/Seoul';
}

function syncWidgetAnchors(state){
  _ensureWidgetAnchorTemplates();
  const pool = document.getElementById('widgetAnchorPool');
  if (!pool || !state?.widgets) return;
  pool.innerHTML = '';
  for (const w of state.widgets) {
    if (w.type === 'calendar') {
      const n = _cloneCalendarAnchor(w);
      if (n) pool.appendChild(n);
    } else if (w.type === 'drive') {
      const n = _cloneDriveAnchor(w);
      if (n) pool.appendChild(n);
    } else if (w.type === 'todo') {
      const n = _cloneTodoAnchor(w);
      if (n) pool.appendChild(n);
    } else if (GWORKSPACE_WIDGET_TYPES.includes(w.type)) {
      const n = _cloneGWorkspaceAnchor(w);
      if (n) pool.appendChild(n);
    } else if (w.type === 'gemini') {
      pool.appendChild(createGeminiWidgetNode(w));
    } else if (w.type === 'clock' || w.type === 'sticky' || w.type === 'pomodoro'
      || w.type === 'dday' || w.type === 'weather') {
      pool.appendChild(createLocalWidgetNode(w));
    }
  }
  syncCatsFromWidgetState(state);
  buildCatPanels();
  const catZone = document.getElementById('catZone');
  if (catZone) {
    const n = state.widgets.filter((x) => x.type === 'category').length;
    if (n > 0) catZone.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  }
}

function initCalWidgetState(widgetId, widget){
  const n = new Date();
  if (!_calWidgetState.has(widgetId)) {
    _calWidgetState.set(widgetId, {
      CY: n.getFullYear(),
      CM: n.getMonth(),
      CS: n.getDate(),
      events: {},
      calendarId: widget?.source?.calendarId || 'primary',
    });
  } else {
    const st = _calWidgetState.get(widgetId);
    st.calendarId = widget?.source?.calendarId || 'primary';
  }
}

function getCalWidgetState(widgetId){
  return _calWidgetState.get(widgetId);
}

function _appendCalDayCell(grid, widgetId, st, dayNum, opts) {
  const { isOther, year, month, day } = opts;
  const el = document.createElement('div');
  el.className = 'cday';
  if (isOther) {
    el.classList.add('other');
    el.textContent = dayNum;
    grid.appendChild(el);
    return;
  }
  const dow = new Date(year, month, day).getDay();
  if (dow === 0) el.classList.add('sun');
  if (dow === 6) el.classList.add('sat');
  const today = new Date();
  const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
  if (isToday) el.classList.add('today');
  if (day === st.CS) el.classList.add('sel');
  const key = `${year}-${p(month + 1)}-${p(day)}`;
  const evs = st.events[key] || [];
  const inlineLimit = calTierInlineLimit(widgetId);
  if (inlineLimit > 0 && evs.length) {
    el.classList.add('has-inline-ev');
    const num = document.createElement('div');
    num.className = 'cday-num';
    num.textContent = dayNum;
    el.appendChild(num);
    const evWrap = document.createElement('div');
    evWrap.className = 'cday-evs';
    const sorted = sortDayEvents(evs);
    sorted.slice(0, inlineLimit).forEach((ev) => {
      const chip = document.createElement('div');
      chip.className = 'cday-ev-chip' + (ev.allDay ? ' allday' : '');
      chip.style.background = ev.color;
      chip.textContent = ev.allDay ? ev.title : `${ev.t} ${ev.title}`;
      chip.title = ev.title;
      evWrap.appendChild(chip);
    });
    if (sorted.length > inlineLimit) {
      const more = document.createElement('div');
      more.className = 'cday-ev-more';
      more.textContent = `+${sorted.length - inlineLimit}`;
      evWrap.appendChild(more);
    }
    el.appendChild(evWrap);
  } else {
    el.textContent = dayNum;
    if (evs.length) el.classList.add('ev');
  }
  el.onclick = () => {
    st.CS = day;
    renderCalForWidget(widgetId);
    renderCalEventsForWidget(widgetId, day);
  };
  grid.appendChild(el);
}

function renderCalForWidget(widgetId){
  const st = getCalWidgetState(widgetId);
  if (!st) return;
  const titleEl = document.getElementById(`calTitle_${widgetId}`);
  const grid = document.getElementById(`calDates_${widgetId}`);
  const box = document.getElementById(`calEvBox_${widgetId}`);
  if (!grid || !box) return;
  if (titleEl) titleEl.textContent = `${st.CY}년 ${st.CM + 1}월`;
  grid.innerHTML = '';
  const first = new Date(st.CY, st.CM, 1).getDay();
  const dim = new Date(st.CY, st.CM + 1, 0).getDate();
  const prev = new Date(st.CY, st.CM, 0).getDate();
  for (let i = first - 1; i >= 0; i--) {
    _appendCalDayCell(grid, widgetId, st, prev - i, { isOther: true, year: st.CY, month: st.CM, day: 0 });
  }
  for (let d = 1; d <= dim; d++) {
    _appendCalDayCell(grid, widgetId, st, d, { isOther: false, year: st.CY, month: st.CM, day: d });
  }
  const total = first + dim;
  const rem = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let d = 1; d <= rem; d++) {
    _appendCalDayCell(grid, widgetId, st, d, { isOther: true, year: st.CY, month: st.CM + 1, day: d });
  }
  renderCalEventsForWidget(widgetId, st.CS);
}

function renderCalEventsForWidget(widgetId, day){
  const st = getCalWidgetState(widgetId);
  const box = document.getElementById(`calEvBox_${widgetId}`);
  if (!st || !box) return;
  box.innerHTML = '';
  const key = `${st.CY}-${p(st.CM + 1)}-${p(day)}`;
  const evs = st.events[key] || [];
  if (!evs.length) {
    const e = document.createElement('div');
    e.style.cssText = 'font-size:11.5px;color:var(--text4);padding:4px 4px;';
    e.textContent = `${st.CM + 1}/${day} — 일정 없음`;
    box.appendChild(e);
  } else {
    const sorted = [...evs].sort((a, b) => {
      if (a.t === '종일') return 1;
      if (b.t === '종일') return -1;
      return a.t.localeCompare(b.t);
    });
    sorted.forEach((ev) => {
      const e = document.createElement('div');
      e.className = 'cev';
      e.innerHTML = `<div class="cev-dot" style="background:${ev.color}"></div>`
        + `<span class="cev-time">${ev.t}</span>`
        + `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${ev.title}</span>`;
      e.style.cursor = 'pointer';
      e.onclick = () => {
        setActiveCalendarWidget(widgetId);
        const dateStr = ev.startDT?.slice(0, 10) || '';
        const [y, m, d] = dateStr ? dateStr.split('-').map(Number) : [st.CY, st.CM + 1, st.CS];
        openEvDialog(y, m - 1, d, ev);
      };
      e.oncontextmenu = (evt) => {
        evt.preventDefault();
        setActiveCalendarWidget(widgetId);
        openCevCtx(evt.clientX, evt.clientY, ev);
      };
      box.appendChild(e);
    });
  }
}

function calMoveForWidget(widgetId, delta){
  const st = getCalWidgetState(widgetId);
  if (!st) return;
  st.CM += delta;
  if (st.CM < 0) { st.CM = 11; st.CY--; }
  if (st.CM > 11) { st.CM = 0; st.CY++; }
  renderCalForWidget(widgetId);
  void syncCalendarForWidget(widgetId);
}

function calResetForWidget(widgetId){
  const n = new Date();
  const st = getCalWidgetState(widgetId);
  if (!st) return;
  st.CY = n.getFullYear();
  st.CM = n.getMonth();
  st.CS = n.getDate();
  renderCalForWidget(widgetId);
}

async function syncCalendarForWidget(widgetId){
  if (!await isAuthenticated()) return;
  const w = _widgetGridState?.widgets?.find((x) => x.id === widgetId);
  const st = getCalWidgetState(widgetId);
  if (!w || !st) return;
  const from = new Date(st.CY, st.CM - 1, 1).toISOString();
  const to = new Date(st.CY, st.CM + 2, 0, 23, 59, 59).toISOString();
  const result = await fetchWidgetCalendarEvents(w, from, to);
  st.events = buildEventMap(result.events || [], result.colorMap || {});
  renderCalForWidget(widgetId);
}

async function syncAllCalendarWidgets(){
  if (isContentSyncPaused() || !_widgetGridState) return;
  if (!await isAuthenticated()) return;
  const widgets = (_widgetGridState?.widgets || []).filter((w) => w.type === 'calendar');
  for (const w of widgets) {
    initCalWidgetState(w.id, w);
    const st = getCalWidgetState(w.id);
    if (!st) continue;
    const from = new Date(st.CY, st.CM - 1, 1).toISOString();
    const to = new Date(st.CY, st.CM + 2, 0, 23, 59, 59).toISOString();
    const result = await fetchWidgetCalendarEvents(w, from, to);
    st.events = buildEventMap(result.events || [], result.colorMap || {});
    renderCalForWidget(w.id);
  }
  const first = widgets[0];
  if (first) {
    const st = getCalWidgetState(first.id);
    if (st) { gcalEvents = st.events; syncGcalToWindow(); }
  }
}

function renderTodoListForWidget(widgetId){
  const w = _widgetGridState?.widgets?.find((x) => x.id === widgetId);
  const list = document.getElementById(`todoList_${widgetId}`);
  if (!w || !list) return;
  const items = Array.isArray(w.items) ? w.items : [];
  list.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'todo-empty';
    empty.textContent = '할 일을 추가해 보세요 ✨';
    list.appendChild(empty);
    return;
  }
  items.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'todo-item' + (item.done ? ' done' : '');
    const chk = document.createElement('div');
    chk.className = 'todo-chk';
    chk.onclick = () => toggleTodoItemForWidget(widgetId, item.id);
    const txt = document.createElement('div');
    txt.className = 'todo-txt';
    txt.textContent = item.text;
    const bell = document.createElement('button');
    bell.className = 'todo-bell' + (item.alarmDT ? ' bell-on' : '');
    bell.title = item.alarmDT ? '알림 설정됨 — 클릭해서 변경' : '알림 설정';
    bell.innerHTML = '🔔';
    bell.onclick = (e) => { e.stopPropagation(); openAlarmMiniPopup(item.id, bell, widgetId); };

    const del = document.createElement('button');
    del.className = 'todo-del';
    del.innerHTML = '×';
    del.onclick = (e) => { e.stopPropagation(); deleteTodoItemForWidget(widgetId, item.id); };
    el.appendChild(chk);
    el.appendChild(txt);
    el.appendChild(bell);
    el.appendChild(del);
    list.appendChild(el);
  });
}

function renderAllTodoWidgets(){
  if (!_widgetGridState?.widgets) return;
  for (const w of _widgetGridState.widgets.filter((x) => x.type === 'todo')) {
    renderTodoListForWidget(w.id);
  }
}

async function addTodoItemForWidget(widgetId){
  const inp = document.getElementById(`todoInput_${widgetId}`);
  const w = _widgetGridState?.widgets?.find((x) => x.id === widgetId);
  if (!inp || !w || !_widgetGridState) return;
  const text = inp.value.trim();
  if (!text) return;
  if (!Array.isArray(w.items)) w.items = [];
  w.items.push({ id: Date.now(), text, done: false, alarmDT: '' });
  inp.value = '';
  renderTodoListForWidget(widgetId);
  await saveState(_widgetGridState, { immediate: true });
}

function toggleTodoItemForWidget(widgetId, itemId){
  const w = _widgetGridState?.widgets?.find((x) => x.id === widgetId);
  if (!w?.items) return;
  const item = w.items.find((t) => t.id === itemId);
  if (!item) return;
  item.done = !item.done;
  renderTodoListForWidget(widgetId);
  void saveState(_widgetGridState);
}

function deleteTodoItemForWidget(widgetId, itemId){
  const w = _widgetGridState?.widgets?.find((x) => x.id === widgetId);
  if (!w?.items) return;
  w.items = w.items.filter((t) => t.id !== itemId);
  renderTodoListForWidget(widgetId);
  void saveState(_widgetGridState);
}

function clearDoneTodosForWidget(widgetId){
  const w = _widgetGridState?.widgets?.find((x) => x.id === widgetId);
  if (!w?.items) return;
  w.items = w.items.filter((t) => !t.done);
  renderTodoListForWidget(widgetId);
  void saveState(_widgetGridState);
}

async function loadDriveImagesForWidget(widgetId, folderId){
  if (isContentSyncPaused()) return;
  if (!folderId) {
    showDriveEmptyForWidget(widgetId, WP_EMPTY_MAIN, '위젯 ⚙ 설정에서 폴더 ID를 입력해 주세요');
    return;
  }
  showDriveLoadingForWidget(widgetId);
  const result = await listDriveImages(folderId);
  if (result.error) {
    showDriveEmptyForWidget(
      widgetId,
      result.error === 'not_authenticated' ? 'Google 계정을 연결해 주세요' : result.error,
      '',
    );
    return;
  }
  if (!driveImgFiles[widgetId]) driveImgFiles[widgetId] = [];
  driveImgFiles[widgetId] = result.files || [];
  driveImgIdx[widgetId] = 0;
  if (!driveImgFiles[widgetId].length) {
    showDriveEmptyForWidget(widgetId, '이 폴더에는 표시할 사진이 없어요', WP_EMPTY_SUB);
    return;
  }
  await showDriveImageForWidget(widgetId, 0);
}

function showDriveLoadingForWidget(widgetId){
  const imgEl = document.getElementById(`driveImg_${widgetId}`);
  const mockEl = document.getElementById(`driveMock_${widgetId}`);
  if (imgEl) imgEl.style.display = 'none';
  if (mockEl) {
    mockEl.style.display = 'flex';
    mockEl.innerHTML = '<div style="font-size:22px">⏳</div><div style="font-size:12px;color:var(--text4)">로딩 중...</div>';
  }
}

function showDriveEmptyForWidget(widgetId, main, sub = WP_EMPTY_SUB){
  const imgEl = document.getElementById(`driveImg_${widgetId}`);
  const mockEl = document.getElementById(`driveMock_${widgetId}`);
  if (imgEl) imgEl.style.display = 'none';
  if (mockEl) {
    mockEl.style.display = 'flex';
    mockEl.innerHTML = wpEmptyStateMarkup(main, 48, sub);
  }
  const countEl = document.getElementById(`driveCount_${widgetId}`);
  if (countEl) countEl.textContent = '0 / 0';
}

async function showDriveImageForWidget(widgetId, idx){
  const files = driveImgFiles[widgetId] || [];
  if (!files.length) return;
  idx = Math.max(0, Math.min(idx, files.length - 1));
  driveImgIdx[widgetId] = idx;
  const fileId = files[idx].id;
  const imgEl = document.getElementById(`driveImg_${widgetId}`);
  const countEl = document.getElementById(`driveCount_${widgetId}`);
  const mockEl = document.getElementById(`driveMock_${widgetId}`);
  if (!imgEl) return;
  if (countEl) countEl.textContent = `${idx + 1} / ${files.length}`;
  if (driveImgCache[fileId]) {
    imgEl.src = driveImgCache[fileId];
    imgEl.style.display = 'block';
    if (mockEl) mockEl.style.display = 'none';
    return;
  }
  imgEl.style.display = 'none';
  if (mockEl) {
    mockEl.style.display = 'flex';
    mockEl.innerHTML = '<div style="font-size:22px">⏳</div><div style="font-size:12px;color:var(--text4)">로딩 중...</div>';
  }
  const result = await getDriveImageData(fileId);
  if (result.error) {
    if (mockEl) mockEl.innerHTML = `<div style="font-size:20px">⚠️</div><div style="font-size:11px;color:var(--text4)">${result.error}</div>`;
    return;
  }
  const dataUrl = `data:${result.mimeType};base64,${result.data}`;
  driveImgCache[fileId] = dataUrl;
  imgEl.src = dataUrl;
  imgEl.style.display = 'block';
  if (mockEl) mockEl.style.display = 'none';
}

function drivePrevForWidget(widgetId){ void showDriveImageForWidget(widgetId, (driveImgIdx[widgetId] ?? 0) - 1); }
function driveNextForWidget(widgetId){ void showDriveImageForWidget(widgetId, (driveImgIdx[widgetId] ?? 0) + 1); }

async function loadDriveFileListForWidget(widgetId, folderId) {
  const listEl = document.getElementById(`driveFileList_${widgetId}`);
  if (!listEl) return;
  if (!folderId) {
    listEl.innerHTML = '<div class="db-empty">폴더 ID를 설정해주세요</div>';
    return;
  }
  listEl.innerHTML = '<div class="db-loading">⏳ 로딩 중...</div>';
  const result = await listDriveFolder(folderId);
  if (result.error === 'not_authenticated') {
    listEl.innerHTML = '<div class="db-unauth">🔐 Google 미연결</div>';
    return;
  }
  if (result.error) {
    listEl.innerHTML = `<div class="db-empty">❌ ${result.error}</div>`;
    return;
  }
  const files = result.files || [];
  if (!files.length) {
    listEl.innerHTML = '<div class="db-empty">📭 비어있어요</div>';
    return;
  }
  listEl.innerHTML = '';
  files.forEach((f) => {
    const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
    const row = document.createElement('div');
    row.className = 'db-item ' + (isFolder ? 'db-folder' : 'db-file');
    const ico = document.createElement('span');
    ico.className = 'db-ico';
    ico.textContent = getDriveFileIcon(f.mimeType);
    const lbl = document.createElement('span');
    lbl.className = 'db-lbl';
    lbl.textContent = f.name;
    row.appendChild(ico);
    row.appendChild(lbl);
    bindGoogleDriveRowDrag(row, f);
    row.addEventListener('click', () => {
      if (row._didGoogleDrag) return;
      if (isFolder) {
        void openExternalUrl(`https://drive.google.com/drive/folders/${f.id}`);
      } else if (f.webViewLink) {
        void openPath(f.webViewLink);
      }
    });
    listEl.appendChild(row);
  });
}

async function driveRefreshForWidget(widgetId){
  const w = _widgetGridState?.widgets?.find((x) => x.id === widgetId);
  if (!w) return;
  const folderId = w.source?.folderId || '';
  await Promise.all([
    loadDriveImagesForWidget(widgetId, folderId),
    loadDriveFileListForWidget(widgetId, folderId),
  ]);
}

function _gworkspaceFileUrl(cfg, file) {
  if (file?.webViewLink) return file.webViewLink;
  if (file?.id && cfg?.fileUrl) return cfg.fileUrl(file.id);
  return cfg?.homeUrl || 'https://drive.google.com';
}

function renderGWorkspaceListForWidget(widgetId, widgetType, result) {
  const listEl = document.getElementById(`gfileList_${widgetId}`);
  const cfg = GWORKSPACE_WIDGET_CONFIG[widgetType];
  if (!listEl || !cfg) return;
  listEl.innerHTML = '';
  if (result?.error === 'not_authenticated') {
    listEl.innerHTML = '<div class="gfile-unauth">🔐 Google 미연결<br><span style="font-size:11px">설정에서 Google 계정을 연결해주세요</span></div>';
    return;
  }
  if (result?.error) {
    listEl.innerHTML = `<div class="gfile-empty">⚠️ ${result.error}</div>`;
    return;
  }
  const files = result?.files || [];
  if (!files.length) {
    listEl.innerHTML = '<div class="gfile-empty">📭 파일이 없어요</div>';
    return;
  }
  files.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'gfile-item';
    row.title = f.name || '';
    const name = document.createElement('span');
    name.className = 'gfile-name';
    name.textContent = f.name || '(이름 없음)';
    row.appendChild(name);
    bindGoogleDriveRowDrag(row, f);
    row.addEventListener('click', () => {
      if (row._didGoogleDrag) return;
      void openExternalUrl(_gworkspaceFileUrl(cfg, f));
    });
    listEl.appendChild(row);
  });
}

async function loadGWorkspaceWidget(widgetId, widgetType, { force = false } = {}) {
  if (isContentSyncPaused()) return;
  const cfg = GWORKSPACE_WIDGET_CONFIG[widgetType];
  if (!cfg) return;
  const listEl = document.getElementById(`gfileList_${widgetId}`);
  if (listEl) listEl.innerHTML = '<div class="gfile-empty">⏳ 로딩 중...</div>';
  const fetcher = () => listDriveFilesByMime(cfg.mime);
  const result = force
    ? await fetcher()
    : await fetchCached(
      _gcalCache,
      buildDriveMimeListKey(cfg.mime),
      DEFAULT_LIST_TTL_MS,
      fetcher,
    );
  renderGWorkspaceListForWidget(widgetId, widgetType, result);
}

async function refreshGWorkspaceWidget(widgetId, widgetType, { force = true } = {}) {
  if (force) invalidateCache(_gcalCache, buildDriveMimeListKey(GWORKSPACE_WIDGET_CONFIG[widgetType]?.mime || ''));
  await loadGWorkspaceWidget(widgetId, widgetType, { force });
}

async function syncAllGWorkspaceWidgets(widgetType) {
  if (isContentSyncPaused() || !_widgetGridState) return;
  for (const w of (_widgetGridState.widgets || []).filter((x) => x.type === widgetType)) {
    await loadGWorkspaceWidget(w.id, widgetType);
  }
}

async function syncAllGWorkspaceWidgetsAll() {
  for (const type of GWORKSPACE_WIDGET_TYPES) {
    await syncAllGWorkspaceWidgets(type);
  }
}

function renderAllGWorkspaceWidgets() {
  if (!_widgetGridState) return;
  for (const w of _widgetGridState.widgets.filter((x) => GWORKSPACE_WIDGET_TYPES.includes(x.type))) {
    void loadGWorkspaceWidget(w.id, w.type);
  }
}

async function syncAllDriveWidgets(){
  if (isContentSyncPaused() || !_widgetGridState) return;
  for (const w of (_widgetGridState?.widgets || []).filter((x) => x.type === 'drive')) {
    const folderId = w.source?.folderId || '';
    await Promise.all([
      loadDriveImagesForWidget(w.id, folderId),
      loadDriveFileListForWidget(w.id, folderId),
    ]);
  }
}

function _backupDefaultFilename() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `dashboard-backup-${y}${m}${day}.json`;
}

function _mapImportError(err) {
  const msg = err?.message || String(err || '');
  if (msg.includes('Invalid state JSON')) return '잘못된 JSON 파일입니다';
  if (msg.includes('Unsupported schema version')) return '지원하지 않는 버전입니다';
  return `가져오기 실패: ${msg}`;
}

async function _getDashboardStateForExport() {
  if (_widgetGridState) return _widgetGridState;
  try {
    return await loadState();
  } catch {
    return null;
  }
}

async function applyImportedDashboardState(imported) {
  const scale = imported?.settings?.scale ?? 100;
  spScale = scale;
  userScale = scale;
  syncSpScaleUI(scale);
  applyScale(scale);

  await initWidgetGrid();
  void fetchAllWeatherWidgets();
  await syncAllCalendarWidgets();
  await syncAllDriveWidgets();
  await syncAllGWorkspaceWidgetsAll();
  await syncGoogleTasks(true);
}

async function exportDashboardState({ includeKeys = true } = {}) {
  try {
    const state = await _getDashboardStateForExport();
    if (!state) {
      showToast('⚠️ 보낼 데이터가 없습니다');
      return;
    }
    const json = exportState(state, { includeKeys });
    const path = await tDialogSave({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      defaultPath: _backupDefaultFilename(),
    });
    if (!path) return;
    const filePath = Array.isArray(path) ? path[0] : path;
    await tInvoke('plugin:fs|write_text_file', new TextEncoder().encode(json), {
      headers: { path: encodeURIComponent(filePath) }
    });
    showToast('✅ 백업 저장됨');
  } catch (e) {
    showToast(`⚠️ 보내기 실패: ${e?.message || '오류'}`);
  }
}

async function importDashboardState() {
  if (!confirm('현재 데이터를 덮어씁니다. 계속할까요?')) return;
  try {
    const picked = await tDialogOpen({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
      title: '백업 파일 가져오기',
    });
    if (!picked) return;
    const filePath = Array.isArray(picked) ? picked[0] : picked;
    const text = await tInvoke('plugin:fs|read_text_file', { path: filePath });
    const imported = importState(text);
    await saveState(imported, { immediate: true });
    _widgetGridState = imported;
    await applyImportedDashboardState(imported);
    showToast('✅ 가져오기 완료');
  } catch (e) {
    showToast(`⚠️ ${_mapImportError(e)}`);
  }
}

function _bindBackupUiOnce() {
  const spExport = document.getElementById('spExportBtn');
  if (spExport && !spExport.dataset.bound) {
    spExport.dataset.bound = '1';
    spExport.addEventListener('click', () => {
      const inc = document.getElementById('spExportIncludeKeys')?.checked !== false;
      void exportDashboardState({ includeKeys: inc });
    });
  }
  const spImport = document.getElementById('spImportBtn');
  if (spImport && !spImport.dataset.bound) {
    spImport.dataset.bound = '1';
    spImport.addEventListener('click', () => { void importDashboardState(); });
  }
}

async function _remountWidgetGridState(){
  const mount = document.getElementById('widgetGridMount');
  if (!mount || !_widgetGridState) return;
  const wasLayoutEditing = isEditMode();
  const layoutEditFocusId = wasLayoutEditing ? getEditFocusWidgetId() : null;
  syncWidgetAnchors(_widgetGridState);
  const anchors = collectPanelAnchors(_widgetGridState);
  _widgetGridTeardown = remountWidgetGrid(mount, _widgetGridState, anchors, _widgetGridTeardown, _widgetGridMountHooks());
  for (const w of _widgetGridState.widgets.filter((x) => x.type === 'calendar')) {
    initCalWidgetState(w.id, w);
    renderCalForWidget(w.id);
  }
  renderAllTodoWidgets();
  initLocalWidgetRuntimes(_widgetGridState);
  initGeminiWidgetRuntimes(_widgetGridState);
  renderAllGWorkspaceWidgets();
  if (wasLayoutEditing) {
    void finishWidgetLayoutEdit(true);
  }
}

function openWidgetTypePicker(){
  document.getElementById('widgetTypePicker')?.classList.add('open');
}

function closeWidgetTypePicker(){
  document.getElementById('widgetTypePicker')?.classList.remove('open');
}

async function addWidgetByType(type){
  if (!_widgetGridState) return;
  _widgetGridState = addWidget(_widgetGridState, type);
  _widgetGridState = normalizeWidgetLayout(_widgetGridState, { force: true });
  closeWidgetTypePicker();
  await _remountWidgetGridState();
  await saveState(_widgetGridState, { immediate: true });
  await syncAllCalendarWidgets();
  await syncAllDriveWidgets();
  await syncAllGWorkspaceWidgetsAll();
  if (document.getElementById('settingsOverlay')?.classList.contains('sp-open')) {
    renderSpWidgetList();
  }
  showToast('✅ 위젯이 추가됐어요');
}

async function deleteWidgetById(widgetId, { confirm: askConfirm = true } = {}){
  if (!_widgetGridState) return;
  if (askConfirm && !confirm('이 위젯을 삭제할까요?')) return;
  const prev = _stickySaveTimers.get(widgetId);
  if (prev) { clearTimeout(prev); _stickySaveTimers.delete(widgetId); }
  _gemStreamAbort.get(widgetId)?.abort();
  _gemStreamAbort.delete(widgetId);
  _stopGeminiReveal(widgetId);
  _widgetGridState = removeWidget(_widgetGridState, widgetId);
  _calWidgetState.delete(widgetId);
  renderSpWidgetList();
  const mount = document.getElementById('widgetGridMount');
  if (mount) {
    syncWidgetAnchors(_widgetGridState);
    pruneWidgetCell(mount, _widgetGridState, widgetId, collectPanelAnchors(_widgetGridState));
  }
  try {
    await _remountWidgetGridState();
  } catch (e) {
    console.warn('[WidgetGrid] remount after delete failed:', e);
  }
  renderSpWidgetList();
  _stopWxTimerIfNone();
  await saveState(_widgetGridState, { immediate: true });
  showToast('🗑 위젯이 삭제됐어요');
}

/* [기능2] 위젯 롱프레스 → 큰 삭제 버튼 → 바깥 클릭/ESC 취소 (iOS식)
   - 기존 드래그/제스처 코드는 건드리지 않음. 독립 리스너로 동작.
   - 이동 바(.widget-move-zone)·리사이즈·버튼·입력 위에서는 롱프레스를 시작하지 않음. */
(function _initWidgetLongPressDelete(){
  if (window.__wLpBound) return;
  window.__wLpBound = true;
  let pendingId = null, timer = null, start = null;
  const LP_MS = 550, MOVE_TOL = 10;

  function clearPending(){
    if (pendingId){
      document.querySelector(`.widget-cell[data-widget-id="${pendingId}"]`)
        ?.classList.remove('widget-delete-pending');
    }
    pendingId = null;
    document.querySelectorAll('.widget-del-overlay').forEach((el) => el.remove());
  }
  function showPending(id){
    clearPending();
    const mount = document.getElementById('widgetGridMount');
    const cell = mount?.querySelector(`.widget-cell[data-widget-id="${id}"]`);
    if (!cell) return;
    pendingId = id;
    cell.classList.add('widget-delete-pending');
    const ov = document.createElement('div');
    ov.className = 'widget-del-overlay';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'widget-del-btn';
    btn.textContent = '🗑 삭제';
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const del = pendingId;
      clearPending();
      if (del) void deleteWidgetById(del, { confirm: false });
    });
    ov.appendChild(btn);
    cell.appendChild(ov);
  }

  document.addEventListener('pointerdown', (e) => {
    // 활성 상태에서 바깥(오버레이/해당 위젯 외) 클릭 → 취소
    if (pendingId){
      const inOverlay = !!e.target.closest('.widget-del-overlay');
      const sameCell = e.target.closest('.widget-cell')?.dataset.widgetId === pendingId;
      if (!inOverlay && !sameCell) clearPending();
    }
    // 롱프레스 감지 시작 (그리드 위젯 본문에서만)
    if (e.button !== 0) return;
    const mount = document.getElementById('widgetGridMount');
    const cell = e.target.closest('.widget-cell');
    if (!mount || !cell || !mount.contains(cell)) return;
    if (e.target.closest('.widget-move-zone, .widget-corner-zone, button, a, input, textarea, select, label, [role="button"], .nb, .ch-nav, .widget-action-btn, .widget-del-overlay')) return;
    const id = cell.dataset.widgetId;
    if (!id) return;
    start = { x: e.clientX, y: e.clientY };
    clearTimeout(timer);
    timer = setTimeout(() => showPending(id), LP_MS);
  }, true);

  document.addEventListener('pointermove', (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOL){
      clearTimeout(timer); start = null;
    }
  }, true);
  const endLp = () => { clearTimeout(timer); start = null; };
  document.addEventListener('pointerup', endLp, true);
  document.addEventListener('pointercancel', endLp, true);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pendingId) clearPending();
  });
})();

async function fetchCalendarListCached(){
  return fetchCached(
    _gcalCache,
    buildCalendarListKey(),
    DEFAULT_LIST_TTL_MS,
    () => getCalendarList(),
  );
}

async function openWidgetSourceDialog(widgetId){
  const w = _widgetGridState?.widgets?.find((x) => x.id === widgetId);
  if (!w) return;
  _widgetSourceEditId = widgetId;
  const dlg = document.getElementById('widgetSourceDialog');
  const titleInp = document.getElementById('wsfTitle');
  const calWrap = document.getElementById('wsfCalendarWrap');
  const taskWrap = document.getElementById('wsfTaskListWrap');
  const folderWrap = document.getElementById('wsfFolderWrap');
  const clockWrap = document.getElementById('wsfClockWrap');
  const pomoWrap = document.getElementById('wsfPomoWrap');
  const ddayWrap = document.getElementById('wsfDdayWrap');
  const weatherWrap = document.getElementById('wsfWeatherWrap');
  const geminiWrap = document.getElementById('wsfGeminiWrap');
  if (!dlg || !titleInp) return;
  titleInp.value = w.title || '';
  calWrap.style.display = 'none';
  taskWrap.style.display = 'none';
  folderWrap.style.display = 'none';
  clockWrap.style.display = 'none';
  pomoWrap.style.display = 'none';
  ddayWrap.style.display = 'none';
  if (weatherWrap) weatherWrap.style.display = 'none';
  if (geminiWrap) geminiWrap.style.display = 'none';
  if (w.type === 'calendar') {
    calWrap.style.display = '';
    await populateWsfCalendarList(w);
  } else if (w.type === 'todo') {
    taskWrap.style.display = '';
    const sel = document.getElementById('wsfTaskList');
    sel.innerHTML = '<option value="">불러오는 중...</option>';
    const res = await getTaskLists();
    sel.innerHTML = '<option value="">— 선택 —</option>';
    if (!res.error) {
      for (const t of res.lists || []) {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.title;
        sel.appendChild(opt);
      }
    }
    sel.value = w.source?.taskListId || '';
  } else if (w.type === 'drive') {
    folderWrap.style.display = '';
    document.getElementById('wsfFolder').value = w.source?.folderId || '';
  } else if (w.type === 'category') {
    titleInp.placeholder = '카테고리 이름';
  } else if (w.type === 'clock') {
    clockWrap.style.display = '';
    _populateClockTzSelect(document.getElementById('wsfClockTz'), w.config?.tz);
    document.getElementById('wsfClockFmt24').checked = w.config?.format24 !== false;
  } else if (w.type === 'pomodoro') {
    pomoWrap.style.display = '';
    document.getElementById('wsfPomoWork').value = w.config?.workMin ?? 25;
    document.getElementById('wsfPomoBreak').value = w.config?.breakMin ?? 5;
  } else if (w.type === 'dday') {
    ddayWrap.style.display = '';
    document.getElementById('wsfDdayDate').value = w.config?.date || '';
    document.getElementById('wsfDdayLabel').value = w.config?.label || '';
  } else if (w.type === 'sticky') {
    titleInp.placeholder = '메모 제목';
  } else if (w.type === 'weather') {
    if (weatherWrap) weatherWrap.style.display = '';
    const locInp = document.getElementById('wsfWeatherLoc');
    const placeSel = document.getElementById('wsfWeatherPlace');
    const unitSel = document.getElementById('wsfWeatherUnit');
    if (locInp) locInp.value = w.config?.loc || '';
    if (unitSel) unitSel.value = w.config?.unit === 'f' ? 'f' : 'c';
    _wxGeoResults.length = 0;
    const curPlace = {
      name: w.config?.placeName || w.config?.loc || '현재 위치',
      lat: w.config?.latitude,
      lon: w.config?.longitude,
      label: w.config?.placeName || w.config?.loc || '현재 위치',
    };
    if (curPlace.lat != null && curPlace.lon != null) {
      _wxGeoResults.push(curPlace);
      _populateWeatherPlaceSelect(placeSel, _wxGeoResults, curPlace.lat, curPlace.lon);
    } else if (placeSel) {
      placeSel.innerHTML = '<option value="">검색 후 선택</option>';
    }
  } else if (w.type === 'gemini') {
    if (geminiWrap) geminiWrap.style.display = '';
    const keyInp = document.getElementById('wsfGeminiKey');
    const modelSel = document.getElementById('wsfGeminiModel');
    if (keyInp) {
      keyInp.value = '';
      keyInp.placeholder = _getGeminiApiKey()
        ? '저장됨 — 변경할 때만 새 키 입력'
        : 'AI Studio API 키';
    }
    _populateGeminiModelSelect(modelSel, w.config?.model);
  }
  dlg.classList.add('open');
}

function closeWidgetSourceDialog(){
  document.getElementById('widgetSourceDialog')?.classList.remove('open');
  _widgetSourceEditId = null;
}

async function saveWidgetSourceDialog(){
  if (!_widgetSourceEditId || !_widgetGridState) return;
  const w = _widgetGridState.widgets.find((x) => x.id === _widgetSourceEditId);
  if (!w) return;
  const title = document.getElementById('wsfTitle')?.value?.trim();
  const patch = { title: title || w.title };
  if (w.type === 'calendar') {
    const calendarIds = getSelectedWsfCalendarIds();
    patch.source = {
      calendarIds,
      calendarId: calendarIds[0] || 'primary',
    };
  } else if (w.type === 'todo') {
    patch.source = { taskListId: document.getElementById('wsfTaskList')?.value || '' };
  } else if (w.type === 'drive') {
    patch.source = { folderId: document.getElementById('wsfFolder')?.value?.trim() || '' };
  } else if (w.type === 'clock') {
    patch.config = {
      tz: document.getElementById('wsfClockTz')?.value || 'Asia/Seoul',
      format24: document.getElementById('wsfClockFmt24')?.checked !== false,
    };
  } else if (w.type === 'pomodoro') {
    patch.config = {
      workMin: parseInt(document.getElementById('wsfPomoWork')?.value, 10) || 25,
      breakMin: parseInt(document.getElementById('wsfPomoBreak')?.value, 10) || 5,
    };
  } else if (w.type === 'dday') {
    patch.config = {
      date: document.getElementById('wsfDdayDate')?.value || '2026-12-31',
      label: document.getElementById('wsfDdayLabel')?.value?.trim() || '마감',
    };
  } else if (w.type === 'weather') {
    const loc = document.getElementById('wsfWeatherLoc')?.value?.trim() || w.config?.loc || '';
    const unit = document.getElementById('wsfWeatherUnit')?.value === 'f' ? 'f' : 'c';
    const placeSel = document.getElementById('wsfWeatherPlace');
    const opt = placeSel?.selectedOptions?.[0];
    let latitude = w.config?.latitude;
    let longitude = w.config?.longitude;
    let placeName = w.config?.placeName || loc;
    if (opt?.dataset?.lat && opt?.dataset?.lon) {
      latitude = parseFloat(opt.dataset.lat);
      longitude = parseFloat(opt.dataset.lon);
      placeName = opt.dataset.name || opt.textContent || placeName;
    }
    patch.config = { loc, unit, latitude, longitude, placeName };
  } else if (w.type === 'gemini') {
    const model = document.getElementById('wsfGeminiModel')?.value || DEFAULT_GEMINI_MODEL;
    patch.config = { model };
    const apiKey = document.getElementById('wsfGeminiKey')?.value?.trim() || '';
    if (apiKey) {
      _widgetGridState = updateStateSecrets(_widgetGridState, { geminiApiKey: apiKey });
    }
  }
  const savedId = _widgetSourceEditId;
  _widgetGridState = updateWidgetSource(_widgetGridState, savedId, patch);
  closeWidgetSourceDialog();
  await _remountWidgetGridState();
  await saveState(_widgetGridState, { immediate: true });
  if (w.type === 'calendar') await syncAllCalendarWidgets();
  if (w.type === 'drive') await syncAllDriveWidgets();
  if (w.type === 'todo') renderTodoListForWidget(savedId);
  if (w.type === 'clock' || w.type === 'dday' || w.type === 'pomodoro') {
    const nw = _widgetGridState.widgets.find((x) => x.id === savedId);
    if (nw?.type === 'clock') renderClockWidget(nw);
    if (nw?.type === 'dday') renderDdayWidget(nw);
    if (nw?.type === 'pomodoro') renderPomodoroWidget(nw);
  }
  if (w.type === 'weather') {
    await fetchWeatherForWidget(savedId, { forceToast: true });
    _ensureWxTimer();
  }
  if (w.type === 'gemini') {
    const nw = _widgetGridState.widgets.find((x) => x.id === savedId);
    if (nw) bindGeminiWidget(nw);
  }
  showToast('✅ 설정이 저장됐어요');
}

async function _resumeDeferredContentSync(){
  try {
    await syncAllCalendarWidgets();
    await syncAllDriveWidgets();
    await syncAllGWorkspaceWidgetsAll();
    await syncGoogleTasks(true);
    await fetchAllWeatherWidgets();
  } catch (e) {
    console.warn('[WidgetGrid] deferred sync resume failed:', e);
  }
}

async function initWidgetGrid(){
  const root = document.getElementById('widgetGridRoot');
  const mount = document.getElementById('widgetGridMount');
  const dashboard = document.getElementById('dashboard');
  if (!root || !mount || !dashboard) return;

  if (isEditMode() && _widgetGridState) {
    exitEditMode(mount, _widgetGridState);
    setContentSyncPaused(false);
    _hideWidgetEditUi();
  }

  try {
    let state = await loadState();
    state = normalizeWidgetLayout(state);
    if (_widgetGridTeardown) _widgetGridTeardown();
    _widgetGridState = state;
    dashboard.classList.add('widget-grid-active');
    root.style.display = '';
    syncWidgetAnchors(state);
    const anchors = collectPanelAnchors(state);
    _widgetGridTeardown = mountWidgetGrid(mount, state, anchors, _widgetGridMountHooks());

    for (const w of state.widgets.filter((x) => x.type === 'calendar')) {
      initCalWidgetState(w.id, w);
      renderCalForWidget(w.id);
    }
    renderAllTodoWidgets();
    initLocalWidgetRuntimes(state);
    initGeminiWidgetRuntimes(state);

    initWidgetTypePickerIcons();
    const typePicker = document.getElementById('widgetTypePicker');
    if (typePicker && !typePicker.dataset.bound) {
      typePicker.dataset.bound = '1';
      typePicker.querySelectorAll('.widget-type-opt').forEach((btn) => {
        btn.addEventListener('click', () => void addWidgetByType(btn.dataset.widgetType));
      });
      document.getElementById('widgetTypeCancel')?.addEventListener('click', closeWidgetTypePicker);
      typePicker.addEventListener('click', (e) => {
        if (e.target === typePicker) closeWidgetTypePicker();
      });
    }
    const srcDlg = document.getElementById('widgetSourceDialog');
    if (srcDlg && !srcDlg.dataset.bound) {
      srcDlg.dataset.bound = '1';
      document.getElementById('widgetSourceCancel')?.addEventListener('click', closeWidgetSourceDialog);
      document.getElementById('widgetSourceSave')?.addEventListener('click', () => void saveWidgetSourceDialog());
      document.getElementById('wsfWeatherSearch')?.addEventListener('click', () => void searchWeatherLocation());
      document.getElementById('wsfGeminiKeyGuide')?.addEventListener('click', () => openGeminiKeyGuideModal());
      document.getElementById('wsfGeminiKeyClear')?.addEventListener('click', async () => {
        if (!_widgetGridState) return;
        const keyInp = document.getElementById('wsfGeminiKey');
        if (keyInp) keyInp.value = '';
        _widgetGridState = updateStateSecrets(_widgetGridState, { geminiApiKey: '' });
        await saveState(_widgetGridState, { immediate: true });
        showToast('🔑 API 키가 초기화됐어요');
      });
      srcDlg.addEventListener('click', (e) => {
        if (e.target === srcDlg) closeWidgetSourceDialog();
      });
    }
    const gemGuide = document.getElementById('geminiKeyGuideDialog');
    if (gemGuide && !gemGuide.dataset.bound) {
      gemGuide.dataset.bound = '1';
      document.getElementById('geminiKeyGuideClose')?.addEventListener('click', closeGeminiKeyGuideModal);
      document.getElementById('geminiStudioLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        openPath('https://aistudio.google.com/apikey');
      });
      gemGuide.addEventListener('click', (e) => {
        if (e.target === gemGuide) closeGeminiKeyGuideModal();
      });
    }

    void syncAllCalendarWidgets();
    void syncAllDriveWidgets();
    void syncAllGWorkspaceWidgetsAll();
  } catch (e) {
    console.warn('[WidgetGrid] init failed:', e);
    showToast('❌ 위젯 그리드를 불러오지 못했습니다');
    _widgetGridState = null;
    _hideWidgetEditUi();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (isEditMode() && _widgetGridState && isLayoutDirty()) {
      saveState(_widgetGridState, { immediate: true }).catch(() => {});
    }
  });
}

/* ── 대시보드 초기화 ── */
function initDashboard(){
  startClock();
  setupTauriFileDrop().catch(e => console.warn('[TauriFileDrop]', e));
  _bindTopbarMenuOnce();
  checkGoogleAuth();      // 인증 상태 확인 → 자동 동기화 + Drive 이미지
  startAlarmWatcher();    // 알림 워처 시작
  _bindBackupUiOnce();
  void initWidgetGrid();
}

/* applySettings 이후 Drive 이미지 재로드 (폴더 ID가 바뀔 수 있으므로) */
function reloadDriveImages(){
  if (isContentSyncPaused() || !_widgetGridState) return;
  void syncAllDriveWidgets();
  void syncAllGWorkspaceWidgetsAll();
}

/* ── Google 인증 상태 확인 + 자동 동기화 ── */
async function checkGoogleAuth(){
  const status = await getAuthStatus();
  updateGoogleChip(status.authenticated);
  if (status.authenticated) {
    syncCalendarSilent();
    reloadDriveImages();
    initGoogleTasksSync();  // Tasks 동기화 버튼 활성화 + 초기 동기화
  }
}

/* ════════════════════════════════════════
   Google Tasks 연동
════════════════════════════════════════ */
async function initGoogleTasksSync(){
  // 저장된 목록 ID 복원 또는 API 조회
  _gtasksListId = localStorage.getItem('gtasksListId') || null;
  if(!_gtasksListId){
    const res = await tasksGetDefaultList();
    if(res?.id){
      _gtasksListId = res.id;
      localStorage.setItem('gtasksListId', _gtasksListId);
    } else {
      // 어떤 에러든 버튼은 표시 (클릭 시 명확한 안내)
      _showTasksSyncBtn();
      return;
    }
  }
  _showTasksSyncBtn();
  // 앱 시작 시 조용히 한 번 동기화
  await syncGoogleTasks(true);
}

function _showTasksSyncBtn(){
  document.querySelectorAll('.todo-sync-btn').forEach((btn) => {
    btn.style.display = '';
    btn.title = 'Google Tasks 동기화';
  });
}

async function syncGoogleTasks(silent){
  if (silent && isContentSyncPaused()) return;
  if(_gtasksSyncing) return;

  // _gtasksListId 없으면 재조회
  if(!_gtasksListId){
    const listRes = await tasksGetDefaultList();
    if(listRes?.id){
      _gtasksListId = listRes.id;
      localStorage.setItem('gtasksListId', _gtasksListId);
    } else {
      if(!silent){
        if(listRes?.error === 'tasks_auth_required' || listRes?.error === 'not_authenticated')
          showToast('⚠️ Tasks 권한 오류 (HTTP ' + (listRes?.status||'?') + '): ' + (listRes?.detail || '설정에서 Google을 재연결해 주세요.'), 6000);
        else
          showToast('❌ Google Tasks 오류: ' + (listRes?.error || '알 수 없는 오류'));
      }
      return;
    }
  }
  _gtasksSyncing = true;
  const syncBtns = document.querySelectorAll('.todo-sync-btn');
  syncBtns.forEach((b) => b.classList.add('syncing'));

  const todoWidgets = (_widgetGridState?.widgets || []).filter((w) => w.type === 'todo');
  const listIds = new Set(todoWidgets.map((w) => w.source?.tasksListId || _gtasksListId).filter(Boolean));
  if (!listIds.size) listIds.add(_gtasksListId);

  const tasksByList = new Map();
  for (const listId of listIds) {
    const result = await tasksListTasks(listId);
    if (result?.error) {
      _gtasksSyncing = false;
      syncBtns.forEach((b) => b.classList.remove('syncing'));
      if (result.error === 'tasks_auth_required') {
        if (!silent) showToast('⚠️ Google Tasks 권한이 없어요. Google을 재연결해 주세요.');
      } else if (!silent) {
        showToast('❌ 동기화 실패: ' + result.error);
      }
      return;
    }
    tasksByList.set(listId, (result.items || []).filter((t) => t.title && !t.deleted && !t.hidden));
  }

  for (const w of todoWidgets) {
    const listId = w.source?.tasksListId || _gtasksListId;
    const googleTasks = tasksByList.get(listId) || [];
    const gtMap = {};
    googleTasks.forEach((t) => { gtMap[t.id] = t; });
    if (!Array.isArray(w.items)) w.items = [];
    const toRemove = new Set();
    w.items.forEach((item) => {
      if (!item.taskId) return;
      const gt = gtMap[item.taskId];
      if (gt) {
        item.text = gt.title || item.text;
        item.done = gt.status === 'completed';
        delete gtMap[item.taskId];
      } else {
        toRemove.add(item.id);
      }
    });
    w.items = w.items.filter((t) => !toRemove.has(t.id));
    Object.values(gtMap).forEach((gt) => {
      w.items.push({
        id: 'gt_' + gt.id,
        text: gt.title,
        done: gt.status === 'completed',
        alarmDT: '',
        taskId: gt.id,
        taskListId: listId,
      });
    });
  }

  localStorage.setItem('gtasksLastSync', Date.now().toString());
  if (_widgetGridState) {
    await saveState(_widgetGridState);
    renderAllTodoWidgets();
  }
  if (!silent) showToast('✅ Google Tasks 동기화 완료');
  _gtasksSyncing = false;
  syncBtns.forEach((b) => b.classList.remove('syncing'));
}

async function syncCalendarSilent(){
  if (isContentSyncPaused()) return;
  if (!await isAuthenticated()) return;
  await syncAllCalendarWidgets();
}

let _googleProfileCache = null;

async function updateGoogleChip(authenticated) {
  const userEl = document.getElementById('tbGoogleUser');
  const avatar = document.getElementById('tbUserAvatar');
  const fallback = document.getElementById('tbUserFallback');
  const label = document.getElementById('tbUserLabel');
  if (!userEl || !label) return;

  if (!authenticated) {
    _googleProfileCache = null;
    userEl.classList.add('is-offline');
    userEl.title = 'Google 미연결 — 설정에서 연결하세요';
    if (avatar) {
      avatar.classList.add('is-hidden');
      avatar.removeAttribute('src');
    }
    if (fallback) {
      fallback.classList.remove('is-hidden');
      fallback.textContent = 'G';
    }
    label.textContent = 'Google 미연결';
    return;
  }

  userEl.classList.remove('is-offline');
  if (!_googleProfileCache) {
    _googleProfileCache = await fetchGoogleUserProfile();
  }
  const profile = _googleProfileCache;
  const display = profile?.name || profile?.email || 'Google 연결됨';
  label.textContent = display;
  userEl.title = profile?.email || display;

  if (profile?.picture && avatar) {
    avatar.src = profile.picture;
    avatar.classList.remove('is-hidden');
    if (fallback) fallback.classList.add('is-hidden');
  } else {
    const initial = (profile?.name || profile?.email || 'G').charAt(0).toUpperCase();
    if (avatar) {
      avatar.classList.add('is-hidden');
      avatar.removeAttribute('src');
    }
    if (fallback) {
      fallback.classList.remove('is-hidden');
      fallback.textContent = initial;
    }
  }
}

/* ── Google Calendar 이벤트 → 날짜별 맵으로 변환 ── */
// Google Calendar colorId → 화면 색상
const GCAL_COLOR_MAP = {
  '1':'#c084fc','2':'#6ee7b7','3':'#60a5fa','4':'#f472b6',
  '5':'#fbbf24','6':'#fb923c','7':'#2dd4bf','8':'#818cf8',
  '9':'#4ade80','10':'#f87171','11':'#94a3b8',
};
const GCAL_DEFAULT_COLOR = '#93c5fd';

var gcalEvents = {}; // { 'YYYY-MM-DD': [{id, t, title, ...}] }
function syncGcalToWindow() { window.gcalEvents = gcalEvents; }
function setGcalEvents(map) { gcalEvents = map || {}; syncGcalToWindow(); }
syncGcalToWindow();

function buildEventMap(items, calendarColorMap = {}) {
  const map = {};
  items.forEach(item => {
    if (item.status === 'cancelled') return;
    const start   = item.start?.dateTime || item.start?.date || '';
    const allDay  = !item.start?.dateTime;
    const dateKey = start.slice(0, 10);
    if (!dateKey) return;

    const timeStr = allDay ? '종일' : start.slice(11, 16);
    const calId = item._calendarId || '';
    const color = calendarColorMap[calId]
      || GCAL_COLOR_MAP[item.colorId]
      || GCAL_DEFAULT_COLOR;

    if (!map[dateKey]) map[dateKey] = [];
    map[dateKey].push({
      id:          item.id,
      t:           timeStr,
      title:       item.summary    || '(제목 없음)',
      color,
      calendarId:  calId,
      gcalLink:    item.htmlLink   || '',
      allDay,
      startDT:     item.start?.dateTime || item.start?.date || '',
      endDT:       item.end?.dateTime   || item.end?.date   || '',
      location:    item.location    || '',
      description: item.description || '',
      colorId:     item.colorId     || '',
    });
  });
  return map;
}

/* 시계 */
function startClock(){
  const days=['일','월','화','수','목','금','토'];
  function tick(){
    const n=new Date();
    document.getElementById('tbDate').textContent=
      `${n.getFullYear()}.${p(n.getMonth()+1)}.${p(n.getDate())} (${days[n.getDay()]})  ${p(n.getHours())}:${p(n.getMinutes())}`;
  }
  tick(); setInterval(tick, 10000);
}
const p = n => String(n).padStart(2,'0');

/* ── 달력 ── */
let CY, CM, CS;
function buildCalendar(){
  const n=new Date(); CY=n.getFullYear(); CM=n.getMonth(); CS=n.getDate();
  renderCal();
}
function calMove(d){
  CM+=d;
  if(CM<0){CM=11;CY--;}
  if(CM>11){CM=0;CY++;}
  renderCal();
}
function calReset(){ const n=new Date(); CY=n.getFullYear(); CM=n.getMonth(); CS=n.getDate(); renderCal(); }

function renderCal(){
  const titleEl = document.getElementById('calTitle2');
  const grid = document.getElementById('calDates');
  if (!titleEl || !grid) return;
  titleEl.textContent=`${CY}년 ${CM+1}월`;
  grid.innerHTML='';
  const today=new Date();
  const first=new Date(CY,CM,1).getDay();
  const dim  =new Date(CY,CM+1,0).getDate();
  const prev =new Date(CY,CM,0).getDate();

  for(let i=first-1;i>=0;i--){
    const el=document.createElement('div'); el.className='cday other'; el.textContent=prev-i; grid.appendChild(el);
  }
  for(let d=1;d<=dim;d++){
    const el=document.createElement('div'); el.className='cday';
    const dow=new Date(CY,CM,d).getDay();
    if(dow===0) el.classList.add('sun');
    if(dow===6) el.classList.add('sat');
    el.textContent=d;
    const isToday=d===today.getDate()&&CM===today.getMonth()&&CY===today.getFullYear();
    if(isToday) el.classList.add('today');
    if(d===CS) el.classList.add('sel');
    const key=`${CY}-${p(CM+1)}-${p(d)}`;
    if(gcalEvents[key]?.length) el.classList.add('ev');
    el.onclick=()=>{ CS=d; renderCal(); renderCalEvents(d); };
    grid.appendChild(el);
  }
  const total=first+dim; const rem=total%7===0?0:7-(total%7);
  for(let d=1;d<=rem;d++){ const el=document.createElement('div'); el.className='cday other'; el.textContent=d; grid.appendChild(el); }
  renderCalEvents(CS);
}

function renderCalEvents(day){
  const box=document.getElementById('calEvBox'); box.innerHTML='';
  const key=`${CY}-${p(CM+1)}-${p(day)}`;
  const evs=gcalEvents[key]||[];

  if(!evs.length){
    const e=document.createElement('div');
    e.style.cssText='font-size:11.5px;color:var(--text4);padding:4px 4px;';
    e.textContent=`${CM+1}/${day} — 일정 없음`;
    box.appendChild(e);
  } else {
    // 시간순 정렬 (종일 → 뒤로)
    const sorted = [...evs].sort((a,b) => {
      if(a.t==='종일') return 1; if(b.t==='종일') return -1;
      return a.t.localeCompare(b.t);
    });
    sorted.forEach(ev=>{
      const e=document.createElement('div'); e.className='cev';
      e.innerHTML=`<div class="cev-dot" style="background:${ev.color}"></div>`+
                  `<span class="cev-time">${ev.t}</span>`+
                  `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${ev.title}</span>`;
      e.style.cursor='pointer';
      // 좌클릭 → 수정 다이얼로그 열기
      e.onclick=()=>{
        const dateStr = ev.startDT?.slice(0,10) || '';
        const [y,m,d] = dateStr ? dateStr.split('-').map(Number) : [CY, CM+1, CS];
        openEvDialog(y, m-1, d, ev);
      };
      // 우클릭 → 수정/삭제 메뉴
      e.oncontextmenu=(evt)=>{
        evt.preventDefault();
        openCevCtx(evt.clientX, evt.clientY, ev);
      };
      box.appendChild(e);
    });
  }

  // 일정 추가 버튼 → 커스텀 다이얼로그 오픈
  const add=document.createElement('div'); add.className='cal-add-btn';
  add.textContent=`+ ${CM+1}/${day} 일정 추가`;
  add.onclick=()=>{ openEvDialog(CY, CM, day); };
  box.appendChild(add);
}

/* Today 섹션 제거됨 */

/* ── 카테고리 패널 ── */
const DEFAULT_CATS = [
  { color:'#ffb3b3', tc:'#9b1c1c', name:'카테고리 1', sub:'', icon:'📁', items:[], note:'', type:'normal', driveRootId:'' },
  { color:'#ffc998', tc:'#92400e', name:'카테고리 2', sub:'', icon:'📁', items:[], note:'', type:'normal', driveRootId:'' },
  { color:'#ffe08a', tc:'#78350f', name:'카테고리 3', sub:'', icon:'📁', items:[], note:'', type:'normal', driveRootId:'' },
  { color:'#a7f3c0', tc:'#065f46', name:'카테고리 4', sub:'', icon:'📁', items:[], note:'', type:'normal', driveRootId:'' },
  { color:'#93c5fd', tc:'#1e3a8a', name:'카테고리 5', sub:'', icon:'📁', items:[], note:'', type:'normal', driveRootId:'' },
];
let CATS = DEFAULT_CATS.map(c => ({ ...c, items: [], note: '' }));

/* Drive 브라우저 탐색 상태 (에피머럴 — localStorage 미저장) */
const _driveNav = {}; // { [catColor]: { folderId, breadcrumbs:[{id,name}], files:[], loading:false } }

/* Drive 드래그 상태 */
let _driveDragFile = null; // legacy HTML5 — WebView2에서는 pointer 경로 사용
let _ptrGoogleFileDrag = null;

/* Drive 컨텍스트 메뉴 상태 */
let _drvCtx = null; // { file, state, reloadFn }

/* Drive 이동 다이얼로그 상태 */
let _drvMove = null; // { file, currentParentId, reloadFn, navStack:[{id,name}], pickedId, pickedName }

/* 무지개 7색 풀세트 (카테고리 7개일 때)
   빨:#ffb3b3  주:#ffc998  노:#ffe08a
   초:#a7f3c0  파:#93c5fd  남:#a5b4fc  보:#d8b4fe  */

/* Google Drive 파일 드래그 → 카테고리 추가/다운로드 */
function googleFileOpenUrl(file) {
  if (file?.webViewLink) return file.webViewLink;
  const isFolder = file?.mimeType === 'application/vnd.google-apps.folder';
  if (isFolder && file?.id) return `https://drive.google.com/drive/folders/${file.id}`;
  if (file?.id) return `https://drive.google.com/file/d/${file.id}/view`;
  return '';
}

function googleFileToCatItem(file) {
  const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
  const ic = isFolder ? '📁' : getDriveFileIcon(file.mimeType);
  let tag = 'Drive';
  const mime = file.mimeType || '';
  if (mime.includes('spreadsheet')) tag = '시트';
  else if (mime.includes('presentation')) tag = '슬라이드';
  else if (mime.includes('document')) tag = '문서';
  else if (isFolder) tag = '폴더';
  else tag = getFileStyle(file.name || '').tag;
  return {
    ic,
    lbl: file.name || '항목',
    tag,
    path: googleFileOpenUrl(file),
  };
}

function clearGoogleFileDropHighlights() {
  document.querySelectorAll('.item.drive-drop-hover').forEach((el) => el.classList.remove('drive-drop-hover'));
  document.querySelectorAll('.cp-body.body-drop-over').forEach((el) => el.classList.remove('body-drop-over'));
  document.querySelectorAll('.cp-drop.google-drop-over').forEach((el) => el.classList.remove('google-drop-over'));
}

function updateGoogleFilePointerTarget(clientX, clientY) {
  if (!_ptrGoogleFileDrag) return;
  clearGoogleFileDropHighlights();
  _ptrGoogleFileDrag.target = null;
  const hit = findGoogleFileDropTarget(clientX, clientY);
  if (!hit) return;
  _ptrGoogleFileDrag.target = hit;
  if (hit.kind === 'folder') hit.row.classList.add('drive-drop-hover');
  else if (hit.kind === 'body') hit.bodyEl.classList.add('body-drop-over');
  else if (hit.kind === 'dropzone') hit.dz.classList.add('google-drop-over');
}

async function commitGoogleFilePointerDrop() {
  const pr = _ptrGoogleFileDrag;
  if (!pr?.moved || !pr.target) return false;

  const dragFile = {
    fileId: pr.file.id,
    fileName: pr.file.name,
    mimeType: pr.file.mimeType,
    webViewLink: pr.file.webViewLink,
  };

  if (pr.target.kind === 'folder') {
    const item = pr.target.item;
    if (!item?.path) { showToast('❌ 경로가 없는 항목이에요'); return false; }
    const stat = await statPath(item.path);
    if (!stat?.isDir) { showToast('❌ 폴더 항목에만 드롭할 수 있어요'); return false; }
    const isGFolder = dragFile.mimeType === 'application/vnd.google-apps.folder';
    showToast(isGFolder
      ? `⬇ ${dragFile.fileName} 폴더 다운로드 중...`
      : `⬇ ${dragFile.fileName} 다운로드 중...`);
    const result = isGFolder
      ? await driveDownloadFolder(dragFile.fileId, dragFile.fileName, item.path)
      : await driveDownloadFile(dragFile.fileId, dragFile.fileName, dragFile.mimeType, item.path);
    if (result?.error) showToast('❌ ' + result.error);
    else if (isGFolder) {
      const n = result.downloaded ?? 0;
      const skip = result.skipped ? ` · ${result.skipped}개 형식 제외` : '';
      showToast(`✅ 폴더 다운로드 완료 (${n}개 파일${skip}) → ${item.lbl}`);
    } else {
      showToast(`✅ 다운로드 완료 → ${item.lbl}`);
    }
    return true;
  }

  await addGoogleDriveItemToCat(pr.target.cat, dragFile);
  return true;
}

/** Tauri WebView2: HTML5 drag 대신 pointer capture + rect 히트 */
function beginGoogleFilePointerDrag(row, file, startEvent) {
  if (_ptrGoogleFileDrag || _ptrItemReorder) return;
  const pid = startEvent.pointerId ?? 1;
  const sx = startEvent.clientX;
  const sy = startEvent.clientY;
  let moved = false;
  let ghost = null;

  try { row.setPointerCapture(pid); } catch (_) {}

  _ptrGoogleFileDrag = {
    file: {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      webViewLink: file.webViewLink,
    },
    row,
    target: null,
    moved: false,
  };

  const onMove = (ev) => {
    if (ev.pointerId !== pid || !_ptrGoogleFileDrag) return;
    if (!moved) {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 6) return;
      moved = true;
      _ptrGoogleFileDrag.moved = true;
      row._didGoogleDrag = true;
      ev.preventDefault();
      row.classList.add('db-dragging');
      document.body.classList.add('google-file-drag-active');
      ghost = document.createElement('div');
      ghost.className = 'item-drag-ghost';
      ghost.textContent = (file.mimeType === 'application/vnd.google-apps.folder' ? '📁 ' : '📄 ')
        + (file.name || '파일');
      ghost.style.left = (ev.clientX + 12) + 'px';
      ghost.style.top = (ev.clientY + 10) + 'px';
      document.body.appendChild(ghost);
    }
    if (ghost) {
      ghost.style.left = (ev.clientX + 12) + 'px';
      ghost.style.top = (ev.clientY + 10) + 'px';
    }
    updateGoogleFilePointerTarget(ev.clientX, ev.clientY);
  };

  const endDrag = (ev) => {
    if (ev.pointerId !== pid) return;
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', endDrag, true);
    document.removeEventListener('pointercancel', endDrag, true);
    try { row.releasePointerCapture(pid); } catch (_) {}
    if (ghost) ghost.remove();
    row.classList.remove('db-dragging');
    document.body.classList.remove('google-file-drag-active');
    clearGoogleFileDropHighlights();
    const hadMove = _ptrGoogleFileDrag?.moved;
    void commitGoogleFilePointerDrop();
    _ptrGoogleFileDrag = null;
    setTimeout(() => { row._didGoogleDrag = false; }, 0);
    if (hadMove) startEvent.preventDefault();
  };

  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', endDrag, true);
  document.addEventListener('pointercancel', endDrag, true);
}

function bindGoogleDriveRowDrag(row, file) {
  if (!file?.id || !row) return;
  row.draggable = false;
  row.style.cursor = 'grab';
  row.style.touchAction = 'none';
  row.title = (file.name || '항목') + ' · 잡고 끌어 카테고리로 이동';
  row.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || _ptrItemReorder || _ptrGoogleFileDrag) return;
    e.stopPropagation();
    beginGoogleFilePointerDrag(row, file, e);
  });
}

async function addGoogleDriveItemToCat(cat, dragFile) {
  if (!cat || !dragFile?.fileId) return false;
  const file = {
    id: dragFile.fileId,
    name: dragFile.fileName,
    mimeType: dragFile.mimeType,
    webViewLink: dragFile.webViewLink,
  };
  cat.items.push(googleFileToCatItem(file));
  await refreshCategoryUi();
  showToast(`✅ "${file.name}" 추가됨`);
  return true;
}

/* 아이템 드래그 상태 */
let _dragSrc = null; // { cat, item }

/* Tauri 네이티브 파일 드롭 — hover 표시용 */
let _fileDropHoverBody = null;

function clearFileDropHover() {
  if (_fileDropHoverBody) {
    _fileDropHoverBody.classList.remove('body-drop-over');
    _fileDropHoverBody = null;
  }
}

async function dropPositionToLogical(position) {
  if (!position) return null;
  let factor = window.devicePixelRatio || 1;
  try {
    factor = await window.__TAURI__.window.getCurrentWindow().scaleFactor();
  } catch {}
  if (typeof position.toLogical === 'function') {
    const logical = position.toLogical(factor);
    return { x: logical.x, y: logical.y };
  }
  const x = position.x ?? position.Physical?.x;
  const y = position.y ?? position.Physical?.y;
  if (x == null || y == null) return null;
  return { x: x / factor, y: y / factor };
}

function catFromDropPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  const panel = el?.closest?.('.cat-panel');
  if (!panel) return null;
  const idx = parseInt(panel.dataset.catIdx, 10);
  if (Number.isNaN(idx) || idx < 0 || idx >= CATS.length) return null;
  return CATS[idx];
}

function setFileDropHover(cat) {
  clearFileDropHover();
  if (!cat) return;
  const idx = CATS.indexOf(cat);
  const panel = document.querySelector(`.cat-panel[data-cat-idx="${idx}"]`);
  const body = panel?.querySelector('.cp-body');
  if (body) {
    body.classList.add('body-drop-over');
    _fileDropHoverBody = body;
  }
}

async function pickFilesForCategory(cat) {
  if (!cat) return;
  if (!window.__TAURI__) {
    showToast('⚠️ 데스크톱 앱에서만 파일을 선택할 수 있어요');
    return;
  }
  try {
    const picked = await tDialogOpen({
      multiple: true,
      title: '파일 선택',
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    await addPathsToCat(paths.filter(Boolean), cat);
  } catch (e) {
    console.error('[pickFilesForCategory]', e);
    showToast('❌ 파일 선택에 실패했어요');
  }
}

async function pickFolderForCategory(cat) {
  if (!cat) return;
  if (!window.__TAURI__) {
    showToast('⚠️ 데스크톱 앱에서만 폴더를 선택할 수 있어요');
    return;
  }
  try {
    const picked = await tDialogOpen({
      multiple: false,
      directory: true,
      title: '폴더 선택',
    });
    if (!picked) return;
    const path = Array.isArray(picked) ? picked[0] : picked;
    if (path) await addPathsToCat([path], cat);
  } catch (e) {
    console.error('[pickFolderForCategory]', e);
    showToast('❌ 폴더 선택에 실패했어요');
  }
}

/** OS 경로 배열 → 카테고리 아이템 추가 (Tauri drag-drop) */
async function addPathsToCat(paths, cat) {
  if (!paths?.length || !cat) return 0;
  let added = 0;
  for (const filePath of paths) {
    if (!filePath) continue;
    const lbl = String(filePath).split(/[\\/]/).pop() || filePath;
    const { isDir } = await statPath(filePath);
    const { ic, tag } = isDir ? { ic: '📁', tag: '폴더' } : getFileStyle(lbl);
    cat.items.push({ ic, lbl, tag, path: filePath });
    added++;
  }
  if (added > 0) {
    void refreshCategoryUi();
    showToast(`✅ ${added}개 항목 추가됨`);
  }
  return added;
}

let _tauriFileDropReady = false;

async function handleTauriDragDropPayload(payload) {
  if (!payload?.type) return;

  if (payload.type === 'leave') {
    clearFileDropHover();
    return;
  }

  if (payload.type === 'enter' || payload.type === 'over') {
    if (!payload.position) return;
    const pos = await dropPositionToLogical(payload.position);
    if (pos) setFileDropHover(catFromDropPoint(pos.x, pos.y));
    return;
  }

  if (payload.type === 'drop') {
    clearFileDropHover();
    const paths = payload.paths || [];
    if (!paths.length) return;

    let cat = null;
    if (payload.position) {
      const pos = await dropPositionToLogical(payload.position);
      if (pos) cat = catFromDropPoint(pos.x, pos.y);
    }
    if (!cat && CATS.length) {
      cat = CATS[0];
      showToast('📂 카테고리를 특정하지 못해 첫 번째 패널에 추가했습니다');
    }
    if (!cat) {
      showToast('❌ 카테고리를 찾을 수 없습니다');
      return;
    }
    await addPathsToCat(paths, cat);
  }
}

async function setupTauriFileDrop() {
  if (_tauriFileDropReady) return;
  _tauriFileDropReady = true;

  /* Tauri v2: onDragDropEvent가 enter/over/drop/leave를 통합 (권장) */
  try {
    const wv =
      window.__TAURI__?.webview?.getCurrentWebview?.() ||
      window.__TAURI__?.webviewWindow?.getCurrentWebviewWindow?.();
    if (wv?.onDragDropEvent) {
      await wv.onDragDropEvent((ev) => handleTauriDragDropPayload(ev.payload));
      return;
    }
  } catch (e) {
    console.warn('[TauriFileDrop] onDragDropEvent:', e);
  }

  /* 폴백: 이벤트별 listen (raw payload에는 type 없음) */
  await tListen('tauri://drag-enter', (ev) =>
    handleTauriDragDropPayload({
      type: 'enter',
      paths: ev.payload?.paths || [],
      position: ev.payload?.position,
    })
  );
  await tListen('tauri://drag-over', (ev) =>
    handleTauriDragDropPayload({
      type: 'over',
      position: ev.payload?.position,
    })
  );
  await tListen('tauri://drag-drop', (ev) =>
    handleTauriDragDropPayload({
      type: 'drop',
      paths: ev.payload?.paths || [],
      position: ev.payload?.position,
    })
  );
  await tListen('tauri://drag-leave', () =>
    handleTauriDragDropPayload({ type: 'leave' })
  );
}

function buildCatPanels(){
  const zone=document.getElementById('catZone'); zone.innerHTML='';
  // 카테고리 수에 맞춰 그리드 열 수 갱신 (초기 로드 / 재렌더 모두 처리)
  zone.style.gridTemplateColumns = `repeat(${CATS.length}, 1fr)`;
  CATS.forEach(cat=>{
    const catIdx = CATS.indexOf(cat);
    const panel=document.createElement('div'); panel.className='cat-panel';
    panel.dataset.catIdx = String(catIdx);
    panel.style.setProperty('--pc',cat.color);

    // 드래그 핸들 바 (상단 컬러 바)
    const dragBar=document.createElement('div'); dragBar.className='cp-drag-bar';
    dragBar.title='드래그해서 카테고리 순서 변경';
    panel.appendChild(dragBar);

    // 헤더
    const head=document.createElement('div'); head.className='cp-head';
    const icon=document.createElement('div'); icon.className='cp-icon'; renderIcon(icon, normalizeIconMarker(cat.icon), 20);
    const meta=document.createElement('div'); meta.className='cp-meta';
    const name=document.createElement('div'); name.className='cp-name';
    name.style.color=cat.tc; name.textContent=cat.name; name.title='더블클릭으로 편집';
    name.addEventListener('dblclick',()=>{
      name.contentEditable='true'; name.focus();
      const s=window.getSelection(),r=document.createRange(); r.selectNodeContents(name); s.removeAllRanges(); s.addRange(r);
    });
    name.addEventListener('blur',()=>{ name.contentEditable='false'; cat.name=name.textContent.trim()||cat.name; saveLegacyAppData(); });
    name.addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();name.blur();} });
    const sub=document.createElement('div'); sub.className='cp-sub'; sub.textContent=cat.sub;
    meta.appendChild(name); meta.appendChild(sub);
    const gear=document.createElement('div'); gear.className='cp-gear'; gear.textContent='⚙';
    gear.onclick=(e)=>{ e.stopPropagation(); openCatEditPopup(e, CATS.indexOf(cat)); };
    icon.onclick=(e)=>{ e.stopPropagation(); openCatEditPopup(e, CATS.indexOf(cat)); };
    const actions=document.createElement('div'); actions.className='cp-actions';
    actions.appendChild(gear);
    head.appendChild(icon); head.appendChild(meta); head.appendChild(actions);

    // ── 아이템 목록 (드래그 리오더 지원) ──
    const body=document.createElement('div'); body.className='cp-body';

    function makeRow(item) {
      const row=document.createElement('div'); row.className='item';
      const tagBg=hexRgba(cat.color,0.18);
      const icoSpan = document.createElement('span');
      icoSpan.className = 'item-ico';
      if (item.ic?.startsWith('data:')) {
        const img = document.createElement('img');
        img.src = item.ic;
        img.style.cssText = 'width:20px;height:20px;object-fit:cover;border-radius:4px;vertical-align:middle';
        icoSpan.appendChild(img);
      } else {
        renderIcon(icoSpan, item.ic || '📄', 18);
      }
      const lbl = document.createElement('span');
      lbl.className = 'item-lbl';
      lbl.textContent = item.lbl;
      const tag = document.createElement('span');
      tag.className = 'item-tag';
      tag.style.cssText = `background:${tagBg};color:${cat.tc};border:1px solid ${hexRgba(cat.color,0.35)}`;
      tag.textContent = item.tag;
      row.appendChild(icoSpan);
      row.appendChild(lbl);
      row.appendChild(tag);

      installItemRowInteractions(row, cat, item);

      // 우클릭 컨텍스트 메뉴
      row.addEventListener('contextmenu',e=>{ e.preventDefault(); showCtx(e.clientX,e.clientY,cat,item); });

      return row;
    }

    cat.items.forEach(item=> body.appendChild(makeRow(item)));

    // 링크 추가 — 1줄 버튼 클릭 시 입력 폼 표시
    const acts=document.createElement('div'); acts.className='cp-drop-btns';

    const addToggleBtn = document.createElement('button');
    addToggleBtn.type = 'button';
    addToggleBtn.className = 'cp-add';
    addToggleBtn.title = '추가';
    addToggleBtn.textContent = '+';
    if (cat.type !== 'drive') actions.insertBefore(addToggleBtn, gear);

    const addMenu = document.createElement('div');
    addMenu.className = 'cp-add-menu is-hidden';

    const folderPickBtn = document.createElement('button');
    folderPickBtn.type = 'button';
    folderPickBtn.className = 'cp-add-opt';
    folderPickBtn.textContent = '📁 폴더';

    const filePickBtn = document.createElement('button');
    filePickBtn.type = 'button';
    filePickBtn.className = 'cp-add-opt';
    filePickBtn.textContent = '📄 파일';

    const linkPickBtn = document.createElement('button');
    linkPickBtn.type = 'button';
    linkPickBtn.className = 'cp-add-opt';
    linkPickBtn.textContent = '🔗 링크';

    addMenu.appendChild(folderPickBtn);
    addMenu.appendChild(filePickBtn);
    addMenu.appendChild(linkPickBtn);

    function hideAddMenu() {
      addMenu.classList.add('is-hidden');
      addToggleBtn.classList.remove('is-open');
    }

    function showAddMenu() {
      row.classList.add('is-hidden');
      addMenu.classList.remove('is-hidden');
      addToggleBtn.classList.add('is-open');
    }

    folderPickBtn.onclick = () => {
      hideAddMenu();
      void pickFolderForCategory(cat);
    };
    filePickBtn.onclick = () => {
      hideAddMenu();
      void pickFilesForCategory(cat);
    };

    const row = document.createElement('div');
    row.className = 'link-input-row is-hidden';

    const titleInp = document.createElement('input');
    titleInp.className = 'link-url-input';
    titleInp.type = 'text';
    titleInp.placeholder = '제목 (예: 네이버)';
    titleInp.maxLength = 40;

    const urlInp = document.createElement('input');
    urlInp.className = 'link-url-input';
    urlInp.type = 'url';
    urlInp.placeholder = 'URL (예: www.naver.com)';

    const btnRow = document.createElement('div');
    btnRow.className = 'link-input-btns';

    const addBtn2 = document.createElement('button');
    addBtn2.className = 'link-add-btn';
    addBtn2.textContent = '✓ 추가';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'link-cancel-btn';
    cancelBtn.textContent = '취소';

    function showLinkForm(){
      hideAddMenu();
      row.classList.remove('is-hidden');
      addToggleBtn.style.display = 'none';
      titleInp.focus();
    }

    function hideLinkForm(){
      titleInp.value = '';
      urlInp.value = '';
      row.classList.add('is-hidden');
      addToggleBtn.style.display = '';
    }

    function submitLink(){
      let url = urlInp.value.trim();
      if(!url){ urlInp.focus(); return; }
      if(!/^https?:\/\//i.test(url)) url = 'https://' + url;
      let lbl = titleInp.value.trim();
      if(!lbl){ try { lbl = new URL(url).hostname.replace(/^www\./,''); } catch{ lbl = url; } }
      cat.items.push({ ic:'🔗', lbl, tag:'URL', path: url });
      void refreshCategoryUi();
      showToast('✅ 링크 추가됨');
    }

    addToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (addMenu.classList.contains('is-hidden')) showAddMenu();
      else hideAddMenu();
    });
    linkPickBtn.addEventListener('click', showLinkForm);
    cancelBtn.addEventListener('click', hideLinkForm);

    titleInp.addEventListener('keydown', e=>{
      if(e.key==='Enter'){ e.preventDefault(); urlInp.focus(); }
      if(e.key==='Escape'){ e.preventDefault(); hideLinkForm(); }
    });
    urlInp.addEventListener('keydown', e=>{
      if(e.key==='Enter'){ e.preventDefault(); submitLink(); }
      if(e.key==='Escape'){ e.preventDefault(); hideLinkForm(); }
    });
    addBtn2.addEventListener('click', submitLink);

    btnRow.appendChild(addBtn2);
    btnRow.appendChild(cancelBtn);
    row.appendChild(titleInp);
    row.appendChild(urlInp);
    row.appendChild(btnRow);
    acts.appendChild(addMenu);
    acts.appendChild(row);

    // ── 노트 영역 — 줄노트 배경 + 태그 방식 ──
    const noteArea = document.createElement('div');
    noteArea.className = 'cp-note-area';

    // 태그 목록
    const tagList = document.createElement('div');
    tagList.className = 'note-tags';

    // note sync helper — tagList DOM → cat.note
    function syncNote() {
      cat.note = Array.from(tagList.querySelectorAll('.tag-txt')).map(e => e.textContent).join('\n');
      saveLegacyAppData();
    }

    // 초기 메모를 태그로 표시
    if (cat.note) {
      cat.note.split('\n').filter(t => t.trim()).forEach(txt => {
        tagList.appendChild(makeNoteTag(txt, cat.color, syncNote));
      });
    }

    // 입력 행
    const inputRow = document.createElement('div');
    inputRow.className = 'note-input-row';

    const inputIcon = document.createElement('span');
    inputIcon.className = 'note-input-icon';
    inputIcon.textContent = '✏️';

    const input = document.createElement('input');
    input.className = 'note-input';
    input.type = 'text';
    input.placeholder = '메모 입력 후 Enter ↵';
    input.maxLength = 60;

    const addBtn = document.createElement('button');
    addBtn.className = 'note-add-btn';
    addBtn.title = '추가 (Enter)';
    addBtn.innerHTML = '+';

    function addNoteTag() {
      const txt = input.value.trim();
      if (!txt) { input.classList.add('shake'); setTimeout(()=>input.classList.remove('shake'),400); return; }
      tagList.appendChild(makeNoteTag(txt, cat.color, syncNote));
      cat.note = (cat.note?.trim() ? cat.note + '\n' : '') + txt;
      input.value = '';
      input.focus();
      saveLegacyAppData();
      showToast('✅ 메모 추가됨');
    }

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addNoteTag(); }
      if (e.key === 'Escape') { input.value = ''; input.blur(); }
    });
    addBtn.addEventListener('click', addNoteTag);

    inputRow.appendChild(inputIcon);
    inputRow.appendChild(input);
    inputRow.appendChild(addBtn);
    noteArea.appendChild(tagList);
    noteArea.appendChild(inputRow);

    if (cat.type === 'drive') {
      panel.appendChild(head);
      panel.appendChild(buildDriveBrowser(cat));
    } else {
      panel.appendChild(head); panel.appendChild(body);
      panel.appendChild(acts); panel.appendChild(noteArea);
    }
    zone.appendChild(panel);
  });
  saveLegacyAppData();
  initPanelDragSort();
}

/* ── 카테고리 패널 드래그 정렬 ── */
function initPanelDragSort(){
  const zone = document.getElementById('catZone');
  if(!zone) return;

  let dragPanelIdx = null, dragEl = null, ghost = null;
  let ghostOffX = 0, ghostOffY = 0;

  zone.querySelectorAll('.cp-drag-bar').forEach((bar, idx) => {
    bar.addEventListener('mousedown', e => {
      if(e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();

      dragPanelIdx = idx;
      dragEl = bar.closest('.cat-panel');
      const rect = dragEl.getBoundingClientRect();
      ghostOffX = e.clientX - rect.left;
      ghostOffY = e.clientY - rect.top;

      // 간단한 고스트 생성
      const cat = CATS[idx];
      ghost = document.createElement('div');
      ghost.className = 'panel-drag-ghost';
      ghost.style.cssText = `left:${e.clientX - ghostOffX}px;top:${e.clientY - ghostOffY}px;width:${Math.min(rect.width * 0.55, 200)}px`;
      const dot = document.createElement('div');
      dot.style.cssText = `width:13px;height:13px;border-radius:50%;background:${cat.color};flex-shrink:0`;
      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'font-size:13px;font-weight:600;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      nameSpan.textContent = cat.name || '';
      ghost.appendChild(dot);
      ghost.appendChild(nameSpan);
      document.body.appendChild(ghost);

      dragEl.classList.add('panel-drag-src');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });

  function clearIndicators(){
    zone.querySelectorAll('.panel-drop-left,.panel-drop-right')
        .forEach(el => el.classList.remove('panel-drop-left','panel-drop-right'));
  }

  function getTargetInfo(clientX){
    const panels = [...zone.querySelectorAll('.cat-panel')];
    for(let i = 0; i < panels.length; i++){
      if(panels[i] === dragEl) continue;
      const r = panels[i].getBoundingClientRect();
      if(clientX >= r.left && clientX <= r.right){
        return { el: panels[i], idx: i, insertBefore: clientX < r.left + r.width / 2 };
      }
    }
    return null;
  }

  function onMove(e){
    if(!ghost) return;
    ghost.style.left = (e.clientX - ghostOffX) + 'px';
    ghost.style.top  = (e.clientY - ghostOffY) + 'px';
    clearIndicators();
    const info = getTargetInfo(e.clientX);
    if(info) info.el.classList.add(info.insertBefore ? 'panel-drop-left' : 'panel-drop-right');
  }

  function onUp(e){
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);

    const info = getTargetInfo(e.clientX);
    if(ghost){ ghost.remove(); ghost = null; }
    if(dragEl){ dragEl.classList.remove('panel-drag-src'); }
    clearIndicators();

    if(info && dragPanelIdx !== null && info.idx !== dragPanelIdx){
      const moved = CATS.splice(dragPanelIdx, 1)[0];
      let insertIdx = info.idx > dragPanelIdx ? info.idx - 1 : info.idx;
      if(!info.insertBefore) insertIdx++;
      CATS.splice(Math.max(0, Math.min(insertIdx, CATS.length)), 0, moved);
      void refreshCategoryUi();
    }

    dragEl = null; dragPanelIdx = null;
  }
}

/** CDP/QA: 패널 순서 변경 + appCats 저장 검증 */
function reorderCatsPanelsForTest() {
  if (CATS.length < 2) return { ok: false, reason: 'need 2+ panels' };
  const firstEl = document.querySelector('#catZone .cat-panel .cp-name');
  const firstName = firstEl?.textContent?.trim() || '';
  const moved = CATS.splice(0, 1)[0];
  CATS.splice(1, 0, moved);
  buildCatPanels();
  const newFirst = document.querySelector('#catZone .cat-panel .cp-name')?.textContent?.trim() || '';
  const saved = localStorage.getItem('appCats');
  return { ok: firstName !== newFirst && !!saved, firstName, newFirst };
}

/* ─────────────────────────────────────────────
   Google Drive 카테고리 브라우저
───────────────────────────────────────────── */
function getDriveFileIcon(mimeType) {
  if (!mimeType) return '📄';
  if (mimeType === 'application/vnd.google-apps.folder') return '📁';
  if (mimeType.startsWith('image/'))                   return '🖼️';
  if (mimeType.startsWith('video/'))                   return '🎬';
  if (mimeType.startsWith('audio/'))                   return '🎵';
  if (mimeType.includes('pdf'))                        return '📄';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📋';
  if (mimeType.includes('document') || mimeType.includes('word')) return '📝';
  if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('compressed')) return '🗜️';
  if (mimeType.startsWith('text/'))                    return '📋';
  return '📄';
}

function buildDriveBrowser(cat) {
  const key = cat.color;
  if (!_driveNav[key]) {
    _driveNav[key] = { folderId: cat.driveRootId || '', breadcrumbs: [], files: [], loading: false };
  }
  const state = _driveNav[key];

  const browser = document.createElement('div');
  browser.className = 'drive-browser';

  /* ── toolbar ── */
  const toolbar = document.createElement('div');
  toolbar.className = 'db-toolbar';

  const crumbWrap = document.createElement('div');
  crumbWrap.className = 'db-crumbs';

  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'db-refresh-btn';
  refreshBtn.title = '새로고침';
  refreshBtn.textContent = '↻';
  refreshBtn.onclick = () => loadFolder(state.folderId, null, true);

  toolbar.appendChild(crumbWrap);
  toolbar.appendChild(refreshBtn);
  browser.appendChild(toolbar);

  /* ── file list ── */
  const listEl = document.createElement('div');
  listEl.className = 'db-list';
  browser.appendChild(listEl);

  function renderCrumbs() {
    crumbWrap.innerHTML = '';
    const rootCrumb = document.createElement('span');
    rootCrumb.className = 'db-crumb' + (state.breadcrumbs.length === 0 ? ' db-crumb-active' : '');
    rootCrumb.textContent = cat.driveRootId ? '📁' : '내 드라이브';
    if (state.breadcrumbs.length > 0) {
      rootCrumb.onclick = () => {
        state.folderId = cat.driveRootId || '';
        state.breadcrumbs = [];
        loadFolder(state.folderId);
      };
    }
    crumbWrap.appendChild(rootCrumb);

    state.breadcrumbs.forEach((crumb, i) => {
      const sep = document.createElement('span');
      sep.className = 'db-crumb-sep'; sep.textContent = '›';
      crumbWrap.appendChild(sep);

      const el = document.createElement('span');
      const isLast = i === state.breadcrumbs.length - 1;
      el.className = 'db-crumb' + (isLast ? ' db-crumb-active' : '');
      el.textContent = crumb.name;
      if (!isLast) {
        el.onclick = () => {
          state.folderId = crumb.id;
          state.breadcrumbs = state.breadcrumbs.slice(0, i + 1);
          loadFolder(state.folderId);
        };
      }
      crumbWrap.appendChild(el);
    });
  }

  function renderList() {
    listEl.innerHTML = '';
    if (state.loading) {
      listEl.innerHTML = '<div class="db-loading">⏳ 로딩 중...</div>';
      return;
    }
    if (state.authError) {
      listEl.innerHTML = '<div class="db-unauth">🔐 Google 계정을 연결해야 해요<br><button class="db-unauth-btn" onclick="reopenSetup()">설정에서 연결</button></div>';
      return;
    }
    if (state.errMsg) {
      listEl.innerHTML = `<div class="db-empty">❌ ${state.errMsg}</div>`;
      return;
    }
    if (!state.files.length) {
      listEl.innerHTML = '<div class="db-empty">📭 비어있어요</div>';
      return;
    }

    state.files.forEach(f => {
      const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
      const row = document.createElement('div');
      row.className = 'db-item ' + (isFolder ? 'db-folder' : 'db-file');

      const ico = document.createElement('span');
      ico.className = 'db-ico';
      ico.textContent = getDriveFileIcon(f.mimeType);

      const lbl = document.createElement('span');
      lbl.className = 'db-lbl';
      lbl.textContent = f.name;

      row.appendChild(ico);
      row.appendChild(lbl);

      if (isFolder) {
        const arr = document.createElement('span');
        arr.className = 'db-arr'; arr.textContent = '›';
        row.appendChild(arr);
        row.onclick = () => {
          if (row._didGoogleDrag) return;
          state.breadcrumbs.push({ id: f.id, name: f.name });
          loadFolder(f.id);
        };
      } else {
        row.onclick = () => {
          if (row._didGoogleDrag) return;
          if (f.webViewLink) openPath(f.webViewLink);
          else showToast('🔗 ' + f.name);
        };
      }

      bindGoogleDriveRowDrag(row, f);

      // 우클릭 → Drive 컨텍스트 메뉴
      row.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        openDrvCtx(e.clientX, e.clientY, f, state, loadFolder);
      });

      listEl.appendChild(row);
    });
  }

  async function loadFolder(folderId, _unused, forceRefresh) {
    state.folderId = folderId;
    state.loading   = true;
    state.authError = false;
    state.errMsg    = null;
    renderCrumbs();
    renderList();

    const result = await listDriveFolder(folderId || '');
    state.loading = false;
    if (result.error === 'not_authenticated') {
      state.authError = true;
    } else if (result.error) {
      state.errMsg = result.error;
    } else {
      state.files = result.files || [];
    }
    renderCrumbs();
    renderList();
  }

  /* 초기 로드 (캐시 있으면 바로 표시) */
  if (state.files.length > 0 && !state.loading) {
    renderCrumbs();
    renderList();
  } else {
    loadFolder(state.folderId);
  }

  return browser;
}

/* ═══════════════════════════════════════════════════
   Drive 컨텍스트 메뉴
═══════════════════════════════════════════════════ */
function openDrvCtx(x, y, file, state, reloadFn) {
  _drvCtx = { file, state, reloadFn };
  const menu = document.getElementById('drvCtxMenu');
  const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
  // 폴더는 다운로드 항목 숨김
  document.getElementById('drvCtxDlItem').style.display = isFolder ? 'none' : '';
  menu.style.left = Math.min(x, window.innerWidth  - 180) + 'px';
  menu.style.top  = Math.min(y, window.innerHeight - 160) + 'px';
  menu.classList.add('drv-open');
  document.getElementById('drvCtxOverlay').classList.add('drv-open');
}
function closeDrvCtx() {
  document.getElementById('drvCtxMenu').classList.remove('drv-open');
  document.getElementById('drvCtxOverlay').classList.remove('drv-open');
  _drvCtx = null;
}
function drvCtxOpen() {
  const f = _drvCtx?.file; closeDrvCtx(); if (!f) return;
  if (f.webViewLink) openPath(f.webViewLink);
}
async function drvCtxDownload() {
  const ctx = _drvCtx; closeDrvCtx(); if (!ctx) return;
  const f = ctx.file;
  const destPath = await selectDownloadFolder();
  if (!destPath) return;
  showToast(`⬇ ${f.name} 다운로드 중...`);
  const result = await driveDownloadFile(f.id, f.name, f.mimeType, destPath);
  if (result?.error) {
    if (result.error.includes('insufficient') || result.error.includes('scope')) showDriveReAuthHint();
    else showToast('❌ ' + result.error);
  } else {
    showToast(`✅ 다운로드 완료: ${result.fileName}`);
  }
}
async function drvCtxTrash() {
  const ctx = _drvCtx; closeDrvCtx(); if (!ctx) return;
  const f = ctx.file;
  if (!confirm(`"${f.name}" 을(를) 휴지통으로 이동할까요?`)) return;
  showToast('🗑 휴지통으로 이동 중...');
  const result = await driveTrashFile(f.id);
  if (result?.error) {
    if (result.error.includes('insufficient') || result.error.includes('scope')) showDriveReAuthHint();
    else showToast('❌ ' + result.error);
  } else {
    showToast(`✅ "${f.name}" 휴지통으로 이동됨`);
    ctx.reloadFn(ctx.state.folderId, null, true);
  }
}
function drvCtxMove() {
  const ctx = _drvCtx; closeDrvCtx(); if (!ctx) return;
  openDrvMove(ctx.file, ctx.state.folderId, ctx.reloadFn);
}

/* ═══════════════════════════════════════════════════
   Drive 이동 다이얼로그
═══════════════════════════════════════════════════ */
function openDrvMove(file, currentParentId, reloadFn) {
  _drvMove = { file, currentParentId, reloadFn, navStack: [], pickedId: null, pickedName: null };
  document.getElementById('drvMoveFileName').textContent = file.name;
  document.getElementById('drvMoveTarget').textContent   = '현재 위치와 동일';
  document.getElementById('drvMoveConfirmBtn').disabled  = true;
  document.getElementById('drvMoveOverlay').classList.add('evd-open');
  document.getElementById('drvMovePanel').style.display  = 'flex';
  document.getElementById('drvMovePanel').style.flexDirection = 'column';
  document.getElementById('drvMovePanel').style.gap = '12px';
  drvMoveLoadFolder('');  // 루트부터
}
function closeDrvMove() {
  document.getElementById('drvMoveOverlay').classList.remove('evd-open');
  document.getElementById('drvMovePanel').style.display = 'none';
  _drvMove = null;
}
async function drvMoveLoadFolder(folderId) {
  if (!_drvMove) return;
  const listEl  = document.getElementById('drvMoveFolderList');
  const crumbEl = document.getElementById('drvMoveCrumb');
  listEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text4);font-size:12px">⏳ 로딩 중...</div>';

  // 브레드크럼 렌더
  crumbEl.innerHTML = '';
  const addCrumb = (name, id, clickable) => {
    if (crumbEl.children.length > 0) {
      const sep = document.createElement('span'); sep.textContent = '›'; sep.style.opacity = '0.5';
      crumbEl.appendChild(sep);
    }
    const el = document.createElement('span');
    el.textContent = name;
    el.style.cssText = `cursor:${clickable?'pointer':'default'};color:${clickable?'#7c3aed':'var(--text2)'};font-weight:${clickable?'400':'600'}`;
    if (clickable) el.onclick = () => { _drvMove.navStack = _drvMove.navStack.slice(0, _drvMove.navStack.findIndex(s=>s.id===id)+1); drvMoveLoadFolder(id); };
    crumbEl.appendChild(el);
  };
  addCrumb('내 드라이브', '', _drvMove.navStack.length > 0);
  _drvMove.navStack.forEach((s, i) => addCrumb(s.name, s.id, i < _drvMove.navStack.length - 1));

  const result = await listDriveFolder(folderId || '');
  if (!_drvMove) return;
  if (result.error) {
    listEl.innerHTML = `<div style="padding:14px;text-align:center;color:#dc2626;font-size:12px">❌ ${result.error}</div>`;
    return;
  }
  const folders = (result.files || []).filter(f => f.mimeType === 'application/vnd.google-apps.folder' && f.id !== _drvMove.file.id);
  if (!folders.length) {
    listEl.innerHTML = '<div style="padding:14px;text-align:center;color:var(--text4);font-size:12px">📭 하위 폴더 없음</div>';
    return;
  }
  listEl.innerHTML = '';
  folders.forEach(f => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;border-radius:8px;transition:background .12s;font-size:13px;color:var(--text2)';
    row.onmouseover = () => row.style.background = 'rgba(139,92,246,0.08)';
    row.onmouseout  = () => row.style.background = '';
    const ico = document.createElement('span'); ico.textContent = '📁';
    const lbl = document.createElement('span'); lbl.textContent = f.name; lbl.style.flex = '1';
    const arr = document.createElement('span'); arr.textContent = '›'; arr.style.opacity = '0.4';
    row.appendChild(ico); row.appendChild(lbl); row.appendChild(arr);
    // 클릭: 선택(이동 위치) + 더블클릭: 폴더 진입
    row.onclick = () => {
      listEl.querySelectorAll('.drv-move-sel').forEach(el => el.classList.remove('drv-move-sel'));
      row.classList.add('drv-move-sel');
      row.style.background = 'rgba(139,92,246,0.14)';
      _drvMove.pickedId   = f.id;
      _drvMove.pickedName = f.name;
      document.getElementById('drvMoveTarget').textContent   = f.name;
      document.getElementById('drvMoveConfirmBtn').disabled  = false;
    };
    row.ondblclick = () => {
      _drvMove.navStack.push({ id: f.id, name: f.name });
      drvMoveLoadFolder(f.id);
    };
    listEl.appendChild(row);
  });
}
async function confirmDrvMove() {
  if (!_drvMove || !_drvMove.pickedId) return;
  const { file, currentParentId, reloadFn, pickedId, pickedName } = _drvMove;
  document.getElementById('drvMoveConfirmBtn').disabled = true;
  document.getElementById('drvMoveConfirmBtn').textContent = '이동 중...';
  const result = await driveMoveFile(file.id, pickedId, currentParentId || 'root');
  closeDrvMove();
  if (result?.error) {
    if (result.error.includes('insufficient') || result.error.includes('scope')) showDriveReAuthHint();
    else showToast('❌ ' + result.error);
  } else {
    showToast(`✅ "${file.name}" → ${pickedName} 으로 이동됨`);
    reloadFn(currentParentId, null, true);
  }
}

/* Drive 권한 부족 시 재연결 안내 */
function showDriveReAuthHint() {
  showToast('⚠️ Google 재연결이 필요해요 (설정 > Google > 재연결)', 4000);
}

/* 노트 태그 생성 */
function makeNoteTag(txt, color, onDelete) {
  const tag = document.createElement('div');
  tag.className = 'note-tag';

  // 카테고리 컬러 점
  const dot = document.createElement('span');
  dot.className = 'cat-dot';
  dot.style.background = color;
  dot.style.boxShadow = `0 0 5px ${color}`;

  // 텍스트
  const label = document.createElement('span');
  label.className = 'tag-txt';
  label.textContent = txt;

  // 삭제 버튼
  const del = document.createElement('button');
  del.className = 'tag-del';
  del.title = '삭제';
  del.innerHTML = '×';
  del.addEventListener('click', e => {
    e.stopPropagation();
    tag.style.animation = 'tagOut .18s ease forwards';
    setTimeout(() => { tag.remove(); if(onDelete) onDelete(); }, 170);
    showToast('🗑 메모 삭제됨');
  });

  tag.appendChild(dot);
  tag.appendChild(label);
  tag.appendChild(del);
  return tag;
}

/* 컨텍스트 메뉴 */
let _ctxCat=null, _ctxItem=null;
function showCtx(x,y,cat,item){
  _ctxCat=cat; _ctxItem=item;
  _renameX=x; _renameY=y;   // 이름 수정 팝업 위치용
  const ctx=document.getElementById('ctx');
  // 화면 밖으로 나가지 않도록 보정
  const cw=ctx.offsetWidth||160, ch=ctx.offsetHeight||140;
  const lx=Math.min(x, window.innerWidth -cw-8);
  const ly=Math.min(y, window.innerHeight-ch-8);
  ctx.style.left=lx+'px'; ctx.style.top=ly+'px';
  ctx.classList.add('show');
}
document.addEventListener('click',e=>{
  if(!e.target.closest('#ctx')) document.getElementById('ctx').classList.remove('show');
});

let _renameX=0, _renameY=0;

(function initCtxHandlers(){
  const ctx=document.getElementById('ctx');
  const [btnOpen,btnCopy,btnRename,btnIconEdit,btnDel]=ctx.querySelectorAll('.ctx-i');
  btnOpen.addEventListener('click', async e => {
    e.stopPropagation();
    ctx.classList.remove('show');
    if (!_ctxItem) return;
    if (!_ctxItem.path) { showToast('❌ 경로가 없어요. 항목을 다시 드래그해서 추가해 주세요.'); return; }
    const r = await openItemPath(_ctxItem);
    if (r?.error) showToast('❌ 열기 실패: ' + String(r.error).slice(0, 80));
  });
  btnCopy.addEventListener('click',e=>{
    e.stopPropagation();
    ctx.classList.remove('show');
    if(!_ctxItem) return;
    const txt=_ctxItem.path||_ctxItem.lbl;
    navigator.clipboard.writeText(txt).then(()=>showToast('📋 경로 복사됨')).catch(()=>showToast('📋 '+txt));
  });
  btnRename.addEventListener('click',e=>{
    e.stopPropagation();
    ctx.classList.remove('show');
    if(!_ctxItem) return;
    showRenamePopup(_renameX, _renameY);
  });
  btnIconEdit.addEventListener('click',e=>{
    e.stopPropagation();
    ctx.classList.remove('show');
    if(!_ctxItem) return;
    showIconPicker(_renameX, _renameY);
  });
  btnDel.addEventListener('click',e=>{
    e.stopPropagation();
    ctx.classList.remove('show');
    if(!_ctxCat||!_ctxItem) return;
    const idx=_ctxCat.items.indexOf(_ctxItem);
    if(idx>=0){ _ctxCat.items.splice(idx,1); void refreshCategoryUi(); showToast(`🗑 "${_ctxItem.lbl}" 제거됨`); }
    _ctxCat=null; _ctxItem=null;
  });
})();

/* ════════════════════════════════════════
   아이콘 피커
════════════════════════════════════════ */
/** 여러 원본 카테고리를 하나의 탭으로 합칠 때 — 이모지 목록 그대로 이어 붙임(개수 유지) */
function _mergeIconLists(...lists) {
  return lists.reduce((acc, list) => acc.concat(list), []);
}

function _layoutIconGrid(gridEl, btnPx, count) {
  if (!gridEl) return;
  const apply = () => {
    const gap = 1;
    const panel = gridEl.closest('.icp-popup') || gridEl.closest('.cep-panel');
    const pad = panel?.classList.contains('cep-panel') ? 48 : 40;
    const w = Math.max((panel?.offsetWidth || 600) - pad, 320);
    let cols = Math.floor((w + gap) / (btnPx + gap));
    cols = Math.min(16, Math.max(12, cols));
    if (count > 0 && count < cols) cols = count;
    gridEl.style.gridTemplateColumns = `repeat(${cols}, ${btnPx}px)`;
    gridEl.style.justifyContent = 'start';
  };
  apply();
  requestAnimationFrame(apply);
}

const _ITEM_ICON_RAW = [
  { label:'📁 파일/문서', icons:[
    '📁','📂','🗂️','📄','📝','📋','📊','📈','📉','📃','📜','📑',
    '🗒️','🗓️','📌','📍','📎','🖇️','✂️','🖊️','✏️','🖋️','🔖','📬',
    '📰','📧','📨','📩','✉️','🗃️','🗄️','📦','📫','📪','📭','📮',
    '🗞️','📇','📅','📆','🗑️','🗳️','🪪','📔','📕','📗','📘','📙',
  ]},
  { label:'🎓 교육/학습', icons:[
    '📚','🎓','🔬','🔭','📐','📏','🧪','🧫','🧬','🏫','🏛️','💡',
    '⭐','🌟','🏆','🎯','🥇','🎖️','🔍','🔎','💬','📢','📣','🗣️',
    '📖','🧮','🔢','🧠','🤔','✍️','🎒','🏅','🥈','🥉','🎺','🎻',
    '🎼','🎹','🧑‍🏫','👨‍🎓','👩‍🎓','📯','🎪','🎭','🖍️','🪶','🗺️','🌍',
  ]},
  { label:'💼 업무/비즈니스', icons:[
    '💼','🏢','🏗️','📊','📈','💰','💵','💳','🤝','📞','☎️','📠',
    '📧','📨','📩','📬','✉️','🗳️','🗺️','📋','🖥️','🖨️','⚖️','🧾',
    '💹','🏦','🏧','💴','💶','💷','🪙','📉','🗂️','🔑','🗝️','🏛️',
    '🏬','🏪','🏭','👔','👨‍💼','👩‍💼','🧑‍💼','📟','🖊️','✒️','📎','📌',
  ]},
  { label:'💻 기술/IT', icons:[
    '💻','🖥️','🖨️','⌨️','🖱️','📱','📲','📡','🔌','💾','💿','📀',
    '🔋','🔧','🔩','⚙️','🛠️','🔐','🔑','🗝️','🔒','🛡️','🧲','🔗',
    '🤖','🦾','🖲️','💽','📟','☁️','🌐','🧩','⚡','🔥','💡','🎮',
    '🕹️','📶','🛰️','🗜️','⚗️','🔭','📷','🎥','🧑‍💻','👨‍💻','👩‍💻','🖧',
  ]},
  { label:'🎨 크리에이티브', icons:[
    '🎨','🖼️','🖌️','✒️','🎭','🎬','🎵','🎶','🎸','🎹','🎤','🎧',
    '📷','📸','📹','🎥','🎞️','📽️','🎙️','🎪','🎊','🎁','🎀','🃏',
    '🎺','🥁','🪕','🎻','🎼','🪗','🎷','🪘','🧵','🪡','🧶','🖍️',
    '🗿','🎡','🎢','🎠','🩰','🎫','🎟️','🪩','🎇','🎆','🧨','🎈',
  ]},
  { label:'🌟 기타/심볼', icons:[
    '⭐','🌟','💫','✨','🔥','💥','❄️','🌊','🌈','☀️','🌙','⚡',
    '🌱','🌿','🍀','🌸','🚀','🛸','🔮','💎','❤️','💜','🧡','💛',
    '💚','💙','🖤','🤍','💔','❣️','💕','💞','💓','💗','💖','💘',
    '💝','☮️','✝️','☪️','🕉️','☯️','♈','♉','♊','♋','♌','♍',
  ]},
  { label:'🏠 생활/장소', icons:[
    '🏠','🏡','🏘️','🏚️','🏗️','🏭','🏢','🏬','🏪','🏫','🏥','🏦',
    '🏨','🏩','💒','⛪','🕌','🛕','⛩️','🗼','🗽','⛲','🏰','🏯',
    '🌆','🌃','🌉','🌁','🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑',
    '🚒','🚐','🛻','🚚','🚛','🚜','🛵','🏍️','🚲','🛴','🚏','🗺️',
  ]},
  { label:'😀 감정/사람', icons:[
    '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊',
    '😇','🥰','😍','🤩','😘','😗','☺️','😚','😙','🥲','😋','😛',
    '😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑',
    '😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','🧑',
    '😎','🤓','🫠','😮‍💨','🫡','👍','👎','🙏','💪','🤝','👋','✌️',
    '🤞','🫶','❤️‍🔥','🥳','😤','😱','🤯','🥺','😭','🤬','👀','🫥',
  ]},
];

/**
 * 아이콘 피커 — 8개 원본 풀을 5개 탭으로 재분류만 함(이모지 개수 유지·합침)
 * 4: 기술+크리에이티브 / 5: 심볼+생활+감정
 */
const ITEM_ICON_SETS = [
  { label:'📁 파일·문서', icons: _ITEM_ICON_RAW[0].icons.slice() },
  { label:'🎓 교육·학습', icons: _ITEM_ICON_RAW[1].icons.slice() },
  { label:'💼 업무·비즈니스', icons: _ITEM_ICON_RAW[2].icons.slice() },
  { label:'💻 IT·창작', icons: _mergeIconLists(_ITEM_ICON_RAW[3].icons, _ITEM_ICON_RAW[4].icons) },
  { label:'🌟 생활·감정', icons: _mergeIconLists(_ITEM_ICON_RAW[5].icons, _ITEM_ICON_RAW[6].icons, _ITEM_ICON_RAW[7].icons) },
];

/** 카테고리 편집 — 항목 피커와 동일 풀 + Google Drive */
const CAT_ICON_SETS = ITEM_ICON_SETS.map((set, i) => ({
  label: set.label,
  icons: i === 0
    ? [GDRIVE_ICON_MARKER, GCAL_ICON_MARKER, GTASK_ICON_MARKER, GEMINI_ICON_MARKER, ...set.icons]
    : set.icons.slice(),
}));

let _icpSelected = '';
let _icpTabIdx   = 0;
let _icpFilter   = '';

function _icpRenderPreview(ic) {
  const box = document.getElementById('icpPreviewBox');
  if (!box) return;
  if (ic && ic.startsWith('data:')) {
    box.innerHTML = `<img src="${ic}">`;
  } else {
    box.textContent = ic || '?';
  }
}

function _iconSetFilter(set, q) {
  if (!q) return set.icons;
  const ql = q.toLowerCase();
  if (set.label.toLowerCase().includes(ql)) return set.icons;
  return set.icons.filter(ic => ic.includes(q));
}

function _icpRenderTab(tabIdx) {
  _icpTabIdx = tabIdx;
  const set  = ITEM_ICON_SETS[tabIdx];
  const grid = document.getElementById('icpGrid');
  const sub  = document.getElementById('icpHeaderSub');
  if (sub) sub.textContent = set.label;
  grid.innerHTML = '';
  const q = (_icpFilter || '').trim();
  const icons = _iconSetFilter(set, q);
  _layoutIconGrid(grid, 38, icons.length);
  if (!icons.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'grid-column:1/-1;padding:12px;text-align:center;font-size:11.5px;color:var(--text4)';
    empty.textContent = '검색 결과 없음';
    grid.appendChild(empty);
    return;
  }
  icons.forEach(ic => {
    const btn = document.createElement('button');
    btn.className = 'icp-icon-btn' + (ic === _icpSelected ? ' icp-sel' : '');
    btn.textContent = ic;
    btn.onclick = () => {
      grid.querySelectorAll('.icp-icon-btn').forEach(b => b.classList.remove('icp-sel'));
      btn.classList.add('icp-sel');
      _icpSelected = ic;
      _icpRenderPreview(ic);
    };
    grid.appendChild(btn);
  });
  // 탭 활성 상태
  document.getElementById('icpTabs').querySelectorAll('.icp-tab').forEach((t,i) => {
    t.classList.toggle('icp-tab-active', i === tabIdx);
  });
}

function showIconPicker(x, y) {
  _icpSelected = _ctxItem?.ic || '';
  _icpFilter = '';
  const searchEl = document.getElementById('icpSearch');
  if (searchEl) {
    searchEl.value = '';
    if (!searchEl._icpBound) {
      searchEl._icpBound = true;
      searchEl.addEventListener('input', () => {
        _icpFilter = searchEl.value;
        _icpRenderTab(_icpTabIdx);
      });
    }
  }
  // 탭 생성 (최초 1회)
  const tabsEl = document.getElementById('icpTabs');
  if (!tabsEl.children.length) {
    ITEM_ICON_SETS.forEach((set, i) => {
      const t = document.createElement('button');
      t.className = 'icp-tab';
      t.textContent = set.label;
      t.onclick = () => _icpRenderTab(i);
      tabsEl.appendChild(t);
    });
  }
  _icpRenderPreview(_icpSelected);
  // 현재 아이콘이 속한 탭 찾기
  let startTab = 0;
  if (_icpSelected && !_icpSelected.startsWith('data:')) {
    ITEM_ICON_SETS.forEach((set, i) => {
      if (set.icons.includes(_icpSelected)) startTab = i;
    });
  }
  const popup = document.getElementById('icpPopup');
  popup.style.visibility = 'hidden';
  popup.style.display = 'flex';
  _icpRenderTab(startTab);
  const pw = popup.offsetWidth  || 600;
  const ph = popup.offsetHeight || 520;
  popup.style.left = Math.min(x, window.innerWidth  - pw - 8) + 'px';
  popup.style.top  = Math.min(y, window.innerHeight - ph - 8) + 'px';
  popup.style.visibility = '';
  document.getElementById('icpOverlay').classList.add('icp-open');
  requestAnimationFrame(() => {
    const grid = document.getElementById('icpGrid');
    const icons = _iconSetFilter(ITEM_ICON_SETS[_icpTabIdx], (_icpFilter || '').trim());
    _layoutIconGrid(grid, 38, icons.length);
  });
}

function closeIconPicker() {
  document.getElementById('icpOverlay').classList.remove('icp-open');
  document.getElementById('icpPopup').style.display   = 'none';
}

function confirmIconPicker() {
  closeIconPicker();
  if (!_icpSelected || !_ctxItem) return;
  _ctxItem.ic = _icpSelected;
  void refreshCategoryUi();
  showToast('🎨 아이콘이 변경됐어요');
}

/* 커스텀 서브메뉴 토글 */
function icpToggleCustomMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('icpCustomMenu');
  menu.classList.toggle('icm-open');
}
document.addEventListener('click', (e) => {
  const menu = document.getElementById('icpCustomMenu');
  const wrap = document.querySelector('.icp-custom-wrap');
  if (menu?.classList.contains('icm-open') && wrap && !wrap.contains(e.target)) {
    menu.classList.remove('icm-open');
  }
});

/* 파일 선택 */
function icpTriggerUpload(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  document.getElementById('icpCustomMenu').classList.remove('icm-open');
  document.getElementById('icpFileInput').value = '';
  document.getElementById('icpFileInput').click();
}

/* ════════════════════════════════════════════════════════════════
   화면 캡처 — 5단계 (plugin-shell + plugin-clipboard-manager + Canvas)
   흐름:
     1. icpStartCapture()       — ms-screenclip: 실행, 창 숨김
     2. _icpWaitFocusRestore()  — 창 포커스 복귀 감지 (캡처 완료/취소 판단)
     3. _icpApplyClipboard()    — Tauri 네이티브 → Web API 순으로 클립보드 읽기
     4. _icpRgbaToDataURL()     — RGBA 바이트 → 64×64 center-crop 데이터URL
     5. _icpBlobToDataURL()     — Blob → 64×64 center-crop 데이터URL
     6. _icpSetImage()          — 아이콘 피커 UI 반영
════════════════════════════════════════════════════════════════ */

/** Windows 화면 캡처 도구 실행 (ms-screenclip 우선, 폴백: 가위채기) */
async function _launchScreenCapture() {
  const tries = ['ms-screenclip:'];
  if (navigator.platform?.toLowerCase().includes('win')) {
    tries.push('C:\\Windows\\System32\\SnippingTool.exe /clip');
  }
  for (const path of tries) {
    const r = await openPath(path);
    if (!r?.error) return true;
    console.warn('[icpCapture] launch failed:', path, r?.error);
  }
  return false;
}

/**
 * 화면 캡처 시작 — 메뉴에서 「캡처」 선택 시 즉시 도구 실행
 */
async function icpStartCapture(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  document.getElementById('icpCustomMenu')?.classList.remove('icm-open');

  const popup   = document.getElementById('icpPopup');
  const overlay = document.getElementById('icpOverlay');
  const win     = window.__TAURI__.window.getCurrentWindow();

  const launched = await _launchScreenCapture();
  if (!launched) {
    showToast('❌ 캡처 도구를 열 수 없어요 — 파일 선택을 이용해 주세요');
    return;
  }

  showToast('📸 캡처할 영역을 드래그하세요...', 20000);

  if (popup)   popup.style.visibility = 'hidden';
  if (overlay) overlay.classList.remove('icp-open');

  try {
    await win.hide();
  } catch (err) {
    console.warn('[icpCapture] hide:', err);
  }

  await _icpWaitFocusRestore();

  try {
    await win.show();
    await win.setFocus();
  } catch (e) {
    console.warn('[icpCapture] show:', e);
  }
  if (popup)   popup.style.visibility = '';
  if (overlay) overlay.classList.add('icp-open');

  await _icpApplyClipboard();
}

/**
 * Tauri 창이 blur 후 다시 focus 될 때까지 기다린다.
 * (캡처 완료 또는 캡처 취소 모두 포함)
 * 최대 30초 대기 후 자동 해제.
 */
async function _icpWaitFocusRestore() {
  return new Promise(async (resolve) => {
    const win      = window.__TAURI__.window.getCurrentWindow();
    let   hadBlur  = false;
    let   resolved = false;
    const unlisteners = [];

    const done = () => {
      if (resolved) return;
      resolved = true;
      unlisteners.forEach(u => { try { u(); } catch {} });
      resolve();
    };

    const timer = setTimeout(done, 30_000);

    // blur 수신 → 창이 백그라운드로 이동 (캡처 도구가 활성화됨)
    unlisteners.push(await win.listen('tauri://blur', () => {
      hadBlur = true;
    }));

    // focus 수신 → 창이 포그라운드로 복귀 (캡처 완료 또는 취소)
    unlisteners.push(await win.listen('tauri://focus', () => {
      if (hadBlur) { clearTimeout(timer); done(); }
    }));
  });
}

/**
 * 클립보드 이미지를 읽어 아이콘 피커에 적용한다.
 * ① Tauri 네이티브 API (plugin-clipboard-manager)  — 권한 불필요, 안정적
 * ② Web Clipboard API (navigator.clipboard.read)   — 폴백
 */
async function _icpApplyClipboard() {
  let dataURL = null;

  // ── 1차: Tauri 네이티브 clipboard-manager ──────────────────
  try {
    // read_image → rid (Resource ID)
    const rid = await tInvoke('plugin:clipboard-manager|read_image');
    const [rgbaRaw, size] = await Promise.all([
      tInvoke('plugin:image|rgba', { rid }),
      tInvoke('plugin:image|size', { rid }),
    ]);
    // 리소스 해제 (백그라운드)
    tInvoke('plugin:resources|close', { rid }).catch(() => {});
    dataURL = _icpRgbaToDataURL(rgbaRaw, size.width, size.height);
  } catch (e) {
    console.warn('[icpCapture] 네이티브 클립보드 실패, Web API로 폴백:', e);
  }

  // ── 2차 폴백: Web Clipboard API ────────────────────────────
  if (!dataURL) {
    try {
      dataURL = await _icpReadClipboardWeb();
    } catch (e) {
      console.warn('[icpCapture] Web 클립보드도 실패:', e);
    }
  }

  if (dataURL) {
    _icpSetImage(dataURL, '📸 캡처 이미지');
    showToast('✅ 캡처 이미지를 가져왔어요');
  } else {
    showToast('📋 클립보드에 이미지가 없어요 — 다시 캡처해주세요');
  }
}

/**
 * RGBA 바이트 배열 → 64×64 center-crop PNG DataURL (Canvas 처리)
 * plugin:image|rgba 가 반환하는 ArrayBuffer / number[] 모두 처리
 */
function _icpRgbaToDataURL(rgbaRaw, width, height) {
  if (!width || !height) return null;

  // ArrayBuffer 또는 number[] → Uint8ClampedArray
  const bytes = (rgbaRaw instanceof ArrayBuffer)
    ? new Uint8ClampedArray(rgbaRaw)
    : new Uint8ClampedArray(rgbaRaw);

  // 전체 크기 캔버스에 RGBA 데이터 기록
  const tmp = document.createElement('canvas');
  tmp.width = width; tmp.height = height;
  tmp.getContext('2d').putImageData(new ImageData(bytes, width, height), 0, 0);

  // 중앙 정사각형 크롭 → 64×64 리사이즈
  const s   = Math.min(width, height);
  const out = document.createElement('canvas');
  out.width = out.height = 64;
  out.getContext('2d').drawImage(
    tmp,
    (width - s) / 2, (height - s) / 2, s, s,
    0, 0, 64, 64
  );
  return out.toDataURL('image/png', 0.88);
}

/**
 * Web Clipboard API 에서 이미지 Blob 을 읽어 64×64 DataURL 로 변환
 * navigator.clipboard.read() 사용 — WebView2 권한 필요
 */
async function _icpReadClipboardWeb() {
  const items = await navigator.clipboard.read();
  for (const clipItem of items) {
    for (const type of clipItem.types) {
      if (!type.startsWith('image/')) continue;
      const blob = await clipItem.getType(type);
      return await _icpBlobToDataURL(blob);
    }
  }
  return null;  // 클립보드에 이미지 없음
}

/**
 * Blob → 64×64 center-crop PNG DataURL (Promise 래퍼)
 */
function _icpBlobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const s   = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      canvas.getContext('2d').drawImage(
        img,
        (img.width - s) / 2, (img.height - s) / 2, s, s,
        0, 0, 64, 64
      );
      resolve(canvas.toDataURL('image/png', 0.88));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

/**
 * 아이콘 피커 UI 에 이미지 데이터URL 을 반영하는 공통 헬퍼
 */
function _icpSetImage(dataURL, label) {
  _icpSelected = dataURL;
  _icpRenderPreview(dataURL);
  document.getElementById('icpGrid')
    ?.querySelectorAll('.icp-icon-btn')
    .forEach(b => b.classList.remove('icp-sel'));
  const sub = document.getElementById('icpHeaderSub');
  if (sub) sub.textContent = label || '🎨 커스텀 이미지';
}

/**
 * 클립보드 직접 읽기 (버튼 등에서 수동 호출용 — icpStartCapture 와 별개)
 * Tauri 네이티브 → Web API 폴백 동일하게 사용
 */
async function _icpReadClipboard() {
  await _icpApplyClipboard();
}

/* 파일 입력 처리 (공통 이미지 리사이즈) */
function icpHandleFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx2 = canvas.getContext('2d');
      const s  = Math.min(img.width, img.height);
      ctx2.drawImage(img, (img.width-s)/2, (img.height-s)/2, s, s, 0, 0, 64, 64);
      _icpSelected = canvas.toDataURL('image/png', 0.88);
      _icpRenderPreview(_icpSelected);
      document.getElementById('icpGrid').querySelectorAll('.icp-icon-btn').forEach(b=>b.classList.remove('icp-sel'));
      document.getElementById('icpHeaderSub').textContent = '📁 업로드 이미지';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/* ── 이름 수정 팝업 ── */
function showRenamePopup(x, y) {
  const popup = document.getElementById('renamePopup');
  const input = document.getElementById('renameInput');
  input.value = _ctxItem?.lbl || '';
  // 화면 밖으로 나가지 않도록 보정
  const pw = 256, ph = 130;
  popup.style.left = Math.min(x, window.innerWidth  - pw - 8) + 'px';
  popup.style.top  = Math.min(y, window.innerHeight - ph - 8) + 'px';
  document.getElementById('renameOverlay').style.display = 'block';
  popup.style.display = 'block';
  requestAnimationFrame(() => { input.focus(); input.select(); });
}

function closeRenamePopup() {
  document.getElementById('renameOverlay').style.display = 'none';
  document.getElementById('renamePopup').style.display   = 'none';
}

function confirmRename() {
  const val = document.getElementById('renameInput').value.trim();
  closeRenamePopup();
  if (!val || !_ctxItem) return;
  const old = _ctxItem.lbl;
  _ctxItem.lbl = val;
  void refreshCategoryUi();
  showToast(`✏️ "${old}" → "${val}"`);
}

/* 파일 확장자 → 아이콘·태그 */
function getFileStyle(name){
  const ext=(name.split('.').pop()||'').toUpperCase();
  const map={
    DOCX:'📝',DOC:'📝',HWP:'📝',HWPX:'📝',ODT:'📝',RTF:'📝',
    XLSX:'📊',XLS:'📊',CSV:'📊',ODS:'📊',
    PPTX:'📋',PPT:'📋',ODP:'📋',
    PDF:'📄',
    PNG:'🖼️',JPG:'🖼️',JPEG:'🖼️',GIF:'🖼️',WEBP:'🖼️',BMP:'🖼️',SVG:'🖼️',
    MP3:'🎵',WAV:'🎵',FLAC:'🎵',AAC:'🎵',OGG:'🎵',M4A:'🎵',
    MP4:'🎬',MKV:'🎬',AVI:'🎬',MOV:'🎬',WMV:'🎬',FLV:'🎬',
    ZIP:'🗜️',RAR:'🗜️','7Z':'🗜️',TAR:'🗜️',GZ:'🗜️',
    EXE:'⚙️',MSI:'⚙️',BAT:'⚙️',CMD:'⚙️',PS1:'⚙️',
    TXT:'📋',MD:'📋',LOG:'📋',
    JS:'💻',TS:'💻',PY:'💻',JAVA:'💻',CS:'💻',CPP:'💻',C:'💻',HTML:'💻',CSS:'💻',
  };
  const ic=map[ext]||'📄';
  const tag=ext||'파일';
  return {ic,tag};
}

/* quitApp 은 브리지 블록(상단)에서 정의됨 — 여기서 중복 정의 제거 */

/* 토스트 */
var toastTimer;
function showToast(msg, duration){
  const t=document.getElementById('toast'); t.textContent=msg;
  t.classList.add('show'); clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'), duration||2200);
}

/* 유틸 */
function hexRgba(hex,a){
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ══════════════════════════════════════════
   카테고리 헤드 편집 팝업
══════════════════════════════════════════ */
const CEP_COLORS = [
  '#ffb3b3','#ffc998','#ffe08a','#a7f3c0','#93c5fd','#a5b4fc','#d8b4fe',
  '#f87171','#fb923c','#fbbf24','#34d399','#60a5fa','#818cf8','#c084fc',
  '#fda4af','#fdba74','#fde68a','#6ee7b7','#7dd3fc','#a78bfa','#e879f9',
];

var cepCatIdx = -1;
var cepSelectedIcon = '';
var cepSelectedColor = '';
var cepSelectedType = 'normal';
let _cepTabIdx = 0;
let _cepFilter = '';

function _cepRenderTab(tabIdx) {
  _cepTabIdx = tabIdx;
  const set = CAT_ICON_SETS[tabIdx];
  const grid = document.getElementById('cepIconGrid');
  if (!grid || !set) return;
  grid.innerHTML = '';
  const q = (_cepFilter || '').trim();
  const icons = _iconSetFilter(set, q);
  _layoutIconGrid(grid, 32, icons.length);
  if (!icons.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'grid-column:1/-1;padding:10px;text-align:center;font-size:11px;color:var(--text4)';
    empty.textContent = '검색 결과 없음';
    grid.appendChild(empty);
    return;
  }
  icons.forEach(ico => {
    const btn = document.createElement('button');
    btn.className = 'cep-icon-btn' + (ico === cepSelectedIcon ? ' cep-sel' : '');
    btn.title = GOOGLE_BRAND_TITLES[ico] || ico;
    renderIcon(btn, ico, 18);
    btn.onclick = () => {
      cepSelectedIcon = ico;
      grid.querySelectorAll('.cep-icon-btn').forEach(b => b.classList.remove('cep-sel'));
      btn.classList.add('cep-sel');
      renderIcon(document.getElementById('cepPreviewIcon'), ico, 22);
    };
    grid.appendChild(btn);
  });
  document.getElementById('cepTabs')?.querySelectorAll('.cep-tab').forEach((t, i) => {
    t.classList.toggle('cep-tab-active', i === tabIdx);
  });
}

function setCepType(type) {
  cepSelectedType = type;
  document.getElementById('cepTypeNormal').classList.toggle('cep-type-sel', type === 'normal');
  document.getElementById('cepTypeDrive').classList.toggle('cep-type-sel',  type === 'drive');
  document.getElementById('cepDriveRootWrap').classList.toggle('cep-drive-show', type === 'drive');
}

function openCatEditPopup(e, catIdx) {
  cepCatIdx = catIdx;
  const cat = CATS[catIdx];
  cepSelectedIcon  = normalizeIconMarker(cat.icon);
  cepSelectedColor = cat.color;

  // 아이콘 탭 피커
  _cepFilter = '';
  const searchEl = document.getElementById('cepIconSearch');
  if (searchEl) {
    searchEl.value = '';
    if (!searchEl._cepBound) {
      searchEl._cepBound = true;
      searchEl.addEventListener('input', () => {
        _cepFilter = searchEl.value;
        _cepRenderTab(_cepTabIdx);
      });
    }
  }
  const tabsEl = document.getElementById('cepTabs');
  if (tabsEl && !tabsEl.children.length) {
    CAT_ICON_SETS.forEach((set, i) => {
      const t = document.createElement('button');
      t.className = 'cep-tab';
      t.textContent = set.label;
      t.onclick = () => _cepRenderTab(i);
      tabsEl.appendChild(t);
    });
  }
  let startTab = 0;
  if (cepSelectedIcon) {
    CAT_ICON_SETS.forEach((set, i) => {
      if (set.icons.includes(cepSelectedIcon)) startTab = i;
    });
  }
  _cepRenderTab(startTab);
  requestAnimationFrame(() => {
    const grid = document.getElementById('cepIconGrid');
    const set = CAT_ICON_SETS[_cepTabIdx];
    if (grid && set) {
      const icons = _iconSetFilter(set, (_cepFilter || '').trim());
      _layoutIconGrid(grid, 32, icons.length);
    }
  });

  // 색상 팔레트
  const colorRow = document.getElementById('cepColorRow');
  colorRow.innerHTML = '';
  CEP_COLORS.forEach(col => {
    const sw = document.createElement('div');
    sw.className = 'cep-color-swatch' + (col === cat.color ? ' cep-color-sel' : '');
    sw.style.background = col;
    sw.title = col;
    sw.onclick = () => {
      cepSelectedColor = col;
      colorRow.querySelectorAll('.cep-color-swatch').forEach(s => s.classList.remove('cep-color-sel'));
      sw.classList.add('cep-color-sel');
      document.getElementById('cepPreviewIcon').style.background = col + '55';
    };
    colorRow.appendChild(sw);
  });

  // 이름·부제목 세팅
  renderIcon(document.getElementById('cepPreviewIcon'), cat.icon, 22);
  document.getElementById('cepPreviewIcon').style.background = cat.color + '55';
  document.getElementById('cepNameInput').value = cat.name;
  document.getElementById('cepSubInput').value  = cat.sub || '';

  // 타입 토글 초기화
  setCepType(cat.type || 'normal');
  document.getElementById('cepDriveRootInput').value = cat.driveRootId || '';

  // 오버레이 열기 (위치 계산 불필요 — 가운데 정렬)
  document.getElementById('catEditPopup').classList.add('cep-open');
  setTimeout(() => document.getElementById('cepNameInput').focus(), 80);
}

function closeCatEditPopup() {
  document.getElementById('catEditPopup').classList.remove('cep-open');
}

function saveCatEditPopup() {
  if (cepCatIdx < 0) return;
  const name = document.getElementById('cepNameInput').value.trim();
  if (!name) return;
  const newType        = cepSelectedType;
  const newDriveRootId = document.getElementById('cepDriveRootInput').value.trim();
  // 변경 전 값 캡처
  const oldColor       = CATS[cepCatIdx].color;
  const oldType        = CATS[cepCatIdx].type;
  const oldDriveRootId = CATS[cepCatIdx].driveRootId || '';

  CATS[cepCatIdx].icon        = normalizeIconMarker(cepSelectedIcon);
  CATS[cepCatIdx].name        = name;
  CATS[cepCatIdx].sub         = document.getElementById('cepSubInput').value.trim();
  CATS[cepCatIdx].color       = cepSelectedColor;
  CATS[cepCatIdx].tc          = darkenColor(cepSelectedColor);
  CATS[cepCatIdx].type        = newType;
  CATS[cepCatIdx].driveRootId = newDriveRootId;

  // 타입이나 루트 폴더가 바뀌었으면 _driveNav 초기화 (새 루트로 재탐색)
  if (newType === 'drive' && (oldType !== 'drive' || oldDriveRootId !== newDriveRootId || oldColor !== cepSelectedColor)) {
    delete _driveNav[oldColor];
    delete _driveNav[cepSelectedColor];
  }

  void refreshCategoryUi();
  closeCatEditPopup();
  showToast('✅ 카테고리 수정됨');
}

// Enter 저장, ESC 취소
document.getElementById('cepNameInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') saveCatEditPopup();
  if (e.key === 'Escape') closeCatEditPopup();
});

// 백드롭 클릭 시 닫기 (패널 바깥 오버레이 영역 클릭)
document.addEventListener('click', e => {
  const popup = document.getElementById('catEditPopup');
  if (popup && popup.classList.contains('cep-open') &&
      !e.target.closest('.cep-panel') &&
      !e.target.closest('.cp-gear') &&
      !e.target.closest('.cp-add') &&
      !e.target.closest('.cp-icon')) {
    closeCatEditPopup();
  }
});

/* ════════════════════════════════════════
   Weekly Plan — 제목 편집 + Drive 폴더 열기
════════════════════════════════════════ */

/* ════════════════════════════════════════
   앱 데이터 저장 / 복원
════════════════════════════════════════ */
function saveLegacyAppData(){
  try {
    localStorage.setItem('appCats',  JSON.stringify(CATS));
    localStorage.setItem('appTodos', JSON.stringify(todoItems));
    localStorage.setItem('appScale', String(userScale));
    localStorage.setItem('calAlarms', JSON.stringify(calAlarms));
  } catch(e) { console.warn('saveLegacyAppData error:', e); }
}

/* 앱 시작 시 저장된 데이터 복원 (모든 함수 정의 후 호출) */
(function loadAppData(){
  try {
    // 카테고리 복원
    const sc = localStorage.getItem('appCats');
    if(sc){
      const parsed = JSON.parse(sc);
      if(Array.isArray(parsed) && parsed.length){
        CATS.length = 0;
        parsed.forEach(c => CATS.push({
          ...c,
          lightColor:   lightenColor(c.color),
          tc:           darkenColor(c.color),
          items:        Array.isArray(c.items) ? c.items : [],
          note:         c.note || '',
          type:         c.type || 'normal',
          driveRootId:  c.driveRootId || '',
        }));
      }
    }
    // 투두 복원
    const st = localStorage.getItem('appTodos');
    if(st){
      const parsed = JSON.parse(st);
      if(Array.isArray(parsed)){ todoItems.length = 0; parsed.forEach(t => todoItems.push(t)); }
    }
    // 배율 복원
    const ss = localStorage.getItem('appScale');
    if(ss){ const v = parseInt(ss); if(!isNaN(v)) userScale = v; }
    // 캘린더 알림 복원
    const sca = localStorage.getItem('calAlarms');
    if(sca){ try { calAlarms = JSON.parse(sca) || {}; } catch(e){ calAlarms = {}; } }
  } catch(e) { console.error('loadAppData error:', e); }
})();

/* ────────────────────────────────────────
   자동 실행
──────────────────────────────────────── */
async function initAutoLaunchUI(){
  try {
    const s = await getLoginItem();
    const on = !!(s?.openAtLogin);
    const cb1 = document.getElementById('setupAutoLaunch');
    const cb2 = document.getElementById('spAutoLaunch');
    if(cb1) cb1.checked = on;
    if(cb2) cb2.checked = on;
  } catch {}
}
async function setAutoLaunch(enabled){
  await setLoginItem(enabled);
  const cb1 = document.getElementById('setupAutoLaunch');
  const cb2 = document.getElementById('spAutoLaunch');
  if(cb1) cb1.checked = enabled;
  if(cb2) cb2.checked = enabled;
  showToast(enabled ? '✅ 시작 시 자동 실행 설정됨' : '✅ 자동 실행 해제됨');
}
// 페이지 로드 시 자동 실행 상태 반영
initAutoLaunchUI();

/* ────────────────────────────────────────
   전체 초기화
──────────────────────────────────────── */
async function resetAllData(){
  if(!confirm('⚠️ 모든 데이터(카테고리·할 일·메모·설정·Google 연결)가 초기화됩니다.\n계속하시겠어요?')) return;
  // Google 토큰 삭제 (keyring + 폴백 파일) — await로 완료 보장
  await googleDisconnect().catch(() => {});
  // 앱 상태 파일 삭제 (AppData/dashboard-state.json + 백업 5개)
  const APP_DATA = 4;
  const stateFiles = [
    'dashboard-state.json', 'dashboard-state.json.tmp',
    ...Array.from({ length: 5 }, (_, i) => `dashboard-state.json.bak.${i + 1}`),
  ];
  await Promise.allSettled(
    stateFiles.map(f => tInvoke('plugin:fs|remove', { path: f, options: { baseDir: APP_DATA } }))
  );
  localStorage.clear();
  location.reload();
}

/* ════════════════════════════════════════
   자동 업데이트 UI
════════════════════════════════════════ */
var _ubState   = 'none'; // 'downloading' | 'downloaded' | 'installing'
var _ubVersion = '';

function onUbBtnClick() {
  if (_ubState !== 'downloaded' || _updateInstallStarted) return;
  beginInstallUpdate();
}

/* 설정 패널 업데이트 상태 표시 헬퍼 */
const MANUAL_UPDATE_URL = 'https://github.com/ggugguai-star/Dashboard/releases/latest';

function setSpUpdateManualLink(show) {
  const wrap = document.getElementById('spUpdateManual');
  const link = document.getElementById('spUpdateManualLink');
  if (wrap) wrap.style.display = show ? 'block' : 'none';
  if (link && !link._bound) {
    link._bound = true;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      void openExternalUrl(MANUAL_UPDATE_URL);
    });
  }
}

function setSpUpdateStatus(msg, color) {
  const el = document.getElementById('spUpdateStatus');
  if (el) { el.textContent = msg; el.style.color = color || 'var(--text4)'; }
}
function setSpUpdateBtnState(loading) {
  const btn = document.getElementById('spUpdateBtn');
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? '⏳ 확인 중...' : '🔄 업데이트 확인';
}

/* 수동 업데이트 확인 버튼 핸들러 */
async function doCheckForUpdates() {
  setSpUpdateBtnState(true);
  setSpUpdateStatus('서버에서 최신 버전을 확인하고 있어요...', 'var(--text4)');
  await checkForUpdates();
  // 결과는 onUpdateStatus 이벤트로 수신
}

/* 앱 버전 표시 (설정 열릴 때 호출) */
async function loadAppVersionDisplay() {
  const v = await getAppVersion();
  const el = document.getElementById('spAppVersion');
  if (el && v) el.textContent = 'v' + v;
}

(function initUpdateListener() {
  onUpdateStatus((info) => {
    const banner   = document.getElementById('updateBanner');
    const verEl    = document.getElementById('ubVersion');
    const progEl   = document.getElementById('ubProgress');
    const btnEl    = document.getElementById('ubBtn');

    const badge = document.getElementById('uoVersionBadge');
    if (info.type === 'available') {
      _ubState = 'downloading';
      _ubVersion = info.version || '';
      if (badge && _ubVersion) badge.textContent = `v${_ubVersion.replace(/^v/i, '')}`;
      setUpdateOverlayProgress(4, '업데이트 파일을 받고 있어요');
      setSpUpdateBtnState(false);
      setSpUpdateStatus(`🆕 새 버전 ${info.version} — 업데이트 중...`, '#7c3aed');
    } else if (info.type === 'progress') {
      const overlayPct = info.overlayPercent ?? mapDownloadOverlayPercent(info.percent || 0);
      setUpdateOverlayProgress(overlayPct, '업데이트 파일을 받고 있어요');
      if (verEl) verEl.textContent = `🆕 새 버전 ${info.version || _ubVersion} 업데이트 중`;
      if (progEl) progEl.textContent = `${overlayPct}%`;
      setSpUpdateStatus(`업데이트 중... ${overlayPct}%`, '#7c3aed');
    } else if (info.type === 'downloaded') {
      _ubState = 'downloaded';
      _ubVersion = info.version || _pendingUpdateVersion;
      if (badge && _ubVersion) badge.textContent = `v${_ubVersion.replace(/^v/i, '')}`;
      setUpdateOverlayProgress(info.overlayPercent ?? 82, '새 버전을 적용하고 있어요');
      setSpUpdateBtnState(false);
      setSpUpdateStatus(`업데이트 적용 중... ${_ubVersion}`, '#7c3aed');
      beginInstallUpdate();
    } else if (info.type === 'not-available') {
      hideUpdateOverlay();
      setSpUpdateBtnState(false);
      setSpUpdateManualLink(false);
      setSpUpdateStatus('✅ 현재 최신 버전이에요!', '#059669');
    } else if (info.type === 'error') {
      hideUpdateOverlay();
      _updateInstallStarted = false;
      setSpUpdateBtnState(false);
      const isKeyRotation = info.code === 'key-rotation'
        || /different key/i.test(info.message || '');
      const isUpdateLoop = info.code === 'update-loop';
      setSpUpdateManualLink(isKeyRotation || isUpdateLoop);
      setSpUpdateStatus(
        (isKeyRotation || isUpdateLoop ? '⚠️ ' : '❌ 확인 실패: ') + (info.message || '알 수 없는 오류'),
        isKeyRotation || isUpdateLoop ? '#b45309' : '#dc2626',
      );
    }
  });
})();

/* 저장된 Drive 폴더 ID 복원 (Setup 입력란) */
(function restoreDriveFolderIds(){
  const wId = localStorage.getItem('driveWeeklyId') || '';
  const mId = localStorage.getItem('driveMemoId')   || '';
  const sw = document.getElementById('setupWeeklyInput');
  const spW = document.getElementById('spWeeklyId');
  const spM = document.getElementById('spMemoId');
  if(sw && wId) sw.value = wId;
  if(spW && wId) spW.value = wId;
  if(spM && mId) spM.value = mId;
})();

/* 저장된 제목 복원 */
(function initWeeklyTitle(){
  const saved = localStorage.getItem('weeklyPlanTitle');
  if(saved){
    const el = document.getElementById('weeklyPlanTitle');
    if(el) el.textContent = saved;
  }
})();

function startEditWeeklyTitle(el){
  if(el.contentEditable === 'true') return;
  el.contentEditable = 'true';
  // 커서를 끝으로
  const range = document.createRange();
  const sel   = window.getSelection();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  el.focus();
}

function saveWeeklyTitle(el){
  el.contentEditable = 'false';
  const val = el.textContent.trim();
  el.textContent = val || 'Weekly Plan';
  localStorage.setItem('weeklyPlanTitle', el.textContent);
}

function weeklyTitleKey(e, el){
  if(e.key === 'Enter'){ e.preventDefault(); el.blur(); }
  if(e.key === 'Escape'){
    const saved = localStorage.getItem('weeklyPlanTitle') || 'Weekly Plan';
    el.textContent = saved;
    el.contentEditable = 'false';
  }
}

/* Drive 폴더 열기 */
function openWeeklyDriveFolder(){
  const folderId = document.getElementById('spWeeklyId')?.value?.trim();
  if(!folderId){
    showToast('⚠️ 설정에서 Drive 폴더 ID를 먼저 입력해 주세요');
    return;
  }
  const url = `https://drive.google.com/drive/folders/${folderId}`;
  openPath(url).catch(() => window.open(url, '_blank'));
}

/* 이미지 라이트박스 → js/lightbox.js (의존성 주입) */
initLightbox({ getFiles: () => driveImgFiles, getIdx: () => driveImgIdx, showDriveImage });

/* ── Google Calendar 열기 ── */
function openGoogleCalendar(){
  void openExternalUrl('https://calendar.google.com');
}

/* ── OAuth 가이드 JS ── */
function openUrl(url){
  // Electron: api.openPath(url) / 브라우저 데모: window.open
  openPath(url).catch(() => window.open(url, '_blank'));
  showToast('🌐 브라우저에서 페이지를 열었어요');
}

/* ── Google 로그인 (설정 탭) ── */
async function doGoogleConnect(){
  showToast('🔑 브라우저에서 Google 계정을 선택해 주세요...');
  const r = await googleAuthStart();
  if(r.success){
    const auth = await getAuthStatus();
    showToast('✅ Google 계정 연결 완료!');
    updateGoogleChip(auth.authenticated);
    updateSettingsGoogleStatus(auth.authenticated);
    if (auth.authenticated) {
      syncCalendarSilent();
      reloadDriveImages();
      initGoogleTasksSync();
    }
  } else {
    showToast('❌ 연결 실패 — ' + (r.error || '다시 시도해 주세요'));
  }
}

/* ── 설정 탭 Google 연결 상태 UI 업데이트 ── */
function updateSettingsGoogleStatus(connected){
  const icon  = document.getElementById('gStatusIcon');
  const text  = document.getElementById('gStatusText');
  const sub   = document.getElementById('gStatusSub');
  const btn   = document.getElementById('gConnectBtn');
  const disc  = document.getElementById('gDisconnectWrap');
  if(!icon) return;
  if(connected){
    icon.textContent   = '✅';
    text.textContent   = 'Google 연결됨';
    text.style.color   = '#16a34a';
    sub.textContent    = '캘린더 일정이 자동으로 동기화돼요';
    btn.style.display  = 'none';
    disc.style.display = 'block';
  } else {
    icon.textContent   = '🔗';
    text.textContent   = 'Google 미연결';
    text.style.color   = 'var(--text1)';
    sub.textContent    = '연결하면 캘린더 일정이 자동으로 동기화돼요';
    btn.style.display  = 'block';
    disc.style.display = 'none';
  }
}

/* Google 연결 해제 */
async function doGoogleDisconnect(){
  await googleDisconnect();
  gcalEvents = {};
  syncGcalToWindow();
  renderCal();
  updateGoogleChip(false);
  updateSettingsGoogleStatus(false);
  driveImgFiles = { weekly:[], memo:[] };
  showDriveEmpty('weekly','Google 미연결');
  showDriveEmpty('memo',  'Google 미연결');
  // Tasks 상태 초기화
  _gtasksListId = null;
  localStorage.removeItem('gtasksListId');
  document.querySelectorAll('.todo-sync-btn').forEach((btn) => { btn.style.display = 'none'; });
  showToast('🔌 Google 연결이 해제됐어요');
}

/* ════════════════════════════════════════
   투두 리스트 (메모 · 할 일 패널)
════════════════════════════════════════ */
var todoItems = [];   // [{ id, text, done, alarmDT, taskId?, taskListId? }]  — loadAppData()에서 복원됨
var calAlarms  = {};  // { [eventId]: { alarmDT, title } }
var _alarmMiniTarget = null;
var _alarmMiniWidgetId = null;
var _alarmQueue = [];
var _alarmShowing = false;
var _gtasksListId   = null;  // Google Tasks 기본 목록 ID
var _gtasksSyncing  = false; // 동기화 중 플래그

function renderTodoList(){
  const list = document.getElementById('todoList');
  if(!list) return;
  list.innerHTML = '';
  if(!todoItems.length){
    const empty = document.createElement('div');
    empty.className = 'todo-empty';
    empty.textContent = '할 일을 추가해 보세요 ✨';
    list.appendChild(empty);
    saveLegacyAppData();
    return;
  }
  todoItems.forEach(item => {
    const el = document.createElement('div');
    el.className = 'todo-item' + (item.done ? ' done' : '');

    const chk = document.createElement('div');
    chk.className = 'todo-chk';
    chk.title = item.done ? '완료 취소' : '완료 표시';
    chk.onclick = () => toggleTodoItem(item.id);

    const txt = document.createElement('div');
    txt.className = 'todo-txt';
    txt.textContent = item.text;

    const bell = document.createElement('button');
    bell.className = 'todo-bell' + (item.alarmDT ? ' bell-on' : '');
    bell.title = item.alarmDT ? '알림 설정됨 — 클릭해서 변경' : '알림 설정';
    bell.innerHTML = '🔔';
    bell.onclick = e => { e.stopPropagation(); openAlarmMiniPopup(item.id, bell); };

    // Google Tasks 배지
    const badge = document.createElement('div');
    badge.className = 'gtask-badge' + (item.taskId ? ' badge-on' : '');
    badge.title = item.taskId ? 'Google Tasks 연동됨' : '';
    badge.textContent = 'G';
    badge.style.display = item.taskId ? '' : 'none';

    const del = document.createElement('button');
    del.className = 'todo-del';
    del.title = '삭제';
    del.innerHTML = '×';
    del.onclick = e => { e.stopPropagation(); deleteTodoItem(item.id); };

    el.appendChild(chk);
    el.appendChild(txt);
    el.appendChild(badge);
    el.appendChild(bell);
    el.appendChild(del);
    list.appendChild(el);
  });
  saveLegacyAppData();
}

async function addTodoItem(){
  const inp = document.getElementById('todoInput');
  if(!inp) return;
  const text = inp.value.trim();
  if(!text){
    inp.style.animation = 'shake .35s ease';
    setTimeout(() => inp.style.animation = '', 400);
    return;
  }
  const newItem = { id: Date.now(), text, done: false, alarmDT: '' };
  todoItems.push(newItem);
  inp.value = '';
  inp.focus();
  renderTodoList();
  // Google Tasks 연동 중이면 새 항목도 Google Tasks에 추가
  if(_gtasksListId){
    const result = await tasksCreateTask(_gtasksListId, { title: text });
    if(result?.id){
      newItem.taskId    = result.id;
      newItem.taskListId = _gtasksListId;
      renderTodoList(); // 배지 표시 갱신
    }
  }
}

function toggleTodoItem(id){
  const item = todoItems.find(t => t.id === id);
  if(!item) return;
  item.done = !item.done;
  renderTodoList();
  // Google Tasks 연동 항목이면 상태 동기화
  if(item.taskId && item.taskListId){
    tasksPatchTask(item.taskListId, item.taskId, {
      status: item.done ? 'completed' : 'needsAction',
    }).catch(()=>{});
  }
}

function deleteTodoItem(id){
  const idx = todoItems.findIndex(t => t.id === id);
  if(idx < 0) return;
  const item = todoItems[idx];
  // Google Tasks 연동 항목이면 원격 삭제
  if(item.taskId && item.taskListId){
    tasksDeleteTask(item.taskListId, item.taskId).catch(()=>{});
  }
  todoItems.splice(idx, 1);
  renderTodoList();
  showToast('🗑 항목 삭제됨');
}

function clearDoneTodos(){
  const removed = todoItems.filter(t => t.done).length;
  todoItems = todoItems.filter(t => !t.done);
  renderTodoList();
  if(removed > 0) showToast(`✅ 완료된 ${removed}개 항목 삭제됨`);
  else showToast('완료된 항목이 없어요');
}

/* ════════════════════════════════════════
   알림(Alarm) 시스템
════════════════════════════════════════ */

/* calAlarms localStorage 저장 */
function saveCalAlarms(){
  try { localStorage.setItem('calAlarms', JSON.stringify(calAlarms)); } catch(e){}
}

let _alarmWatchTimer = null;

/* 알림 워처 시작 — initDashboard()에서 호출 (앱이 켜져 있는 동안만 동작) */
function startAlarmWatcher(){
  if (_alarmWatchTimer) clearInterval(_alarmWatchTimer);
  checkAlarms();
  _alarmWatchTimer = setInterval(checkAlarms, 10000);
}

/* 알림 발화 여부 체크 — 로컬 투두·캘린더 일정 알림 (Google 서버 푸시 아님) */
function checkAlarms(){
  const now = Date.now();
  const STALE = 5 * 60 * 1000;

  let todoDirty = false;
  todoItems.forEach(item => {
    if (!item.alarmDT) return;
    const t = parseLocalDateTime(item.alarmDT);
    if (!Number.isFinite(t)) return;
    if (now >= t) {
      if (now - t < STALE) queueAlarmNotif({ type: 'todo', label: item.text, dt: item.alarmDT });
      item.alarmDT = '';
      todoDirty = true;
    }
  });
  if (todoDirty) { saveLegacyAppData(); renderTodoList(); }

  let widgetDirty = false;
  const dirtyWidgetIds = new Set();
  for (const w of (_widgetGridState?.widgets || []).filter((x) => x.type === 'todo')) {
    for (const item of (w.items || [])) {
      if (!item.alarmDT) continue;
      const t = parseLocalDateTime(item.alarmDT);
      if (!Number.isFinite(t)) continue;
      if (now >= t) {
        if (now - t < STALE) queueAlarmNotif({ type: 'todo', label: item.text, dt: item.alarmDT });
        item.alarmDT = '';
        widgetDirty = true;
        dirtyWidgetIds.add(w.id);
      }
    }
  }
  if (widgetDirty) {
    void saveState(_widgetGridState);
    dirtyWidgetIds.forEach((wid) => renderTodoListForWidget(wid));
  }

  let calDirty = false;
  Object.entries(calAlarms).forEach(([evId, al]) => {
    const t = parseLocalDateTime(al.alarmDT);
    if (!Number.isFinite(t)) { delete calAlarms[evId]; calDirty = true; return; }
    if (now >= t) {
      if (now - t < STALE) queueAlarmNotif({ type: 'cal', label: al.title, dt: al.alarmDT });
      delete calAlarms[evId];
      calDirty = true;
    }
  });
  if (calDirty) saveCalAlarms();
}

function queueAlarmNotif(alarm){
  _alarmQueue.push(alarm);
  if(!_alarmShowing) showNextAlarm();
}

function showNextAlarm(){
  if(!_alarmQueue.length){ _alarmShowing = false; return; }
  _alarmShowing = true;
  const alarm = _alarmQueue.shift();

  const isCalendar = alarm.type === 'cal';
  document.getElementById('alarmBellIcon').textContent  = isCalendar ? '📅' : '🔔';
  document.getElementById('alarmCardType').textContent  = isCalendar ? '📅 일정 알림' : '✅ 할 일 알림';
  document.getElementById('alarmCardTitle').textContent = alarm.label;

  try {
    const d = new Date(alarm.dt);
    document.getElementById('alarmCardTime').textContent =
      d.toLocaleString('ko-KR', { month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
  } catch(e){
    document.getElementById('alarmCardTime').textContent = alarm.dt;
  }

  document.getElementById('alarmOverlay').classList.add('alarm-show');
  focusWindow();
}

function dismissAlarmNotif(){
  document.getElementById('alarmOverlay').classList.remove('alarm-show');
  _alarmShowing = false;
  setTimeout(showNextAlarm, 360);
}

/** CDP/QA: 알람 오버레이 + focusWindow 동작 확인용 */
function triggerTestAlarmForQA(){
  queueAlarmNotif({
    type: 'todo',
    label: 'P2 알람 테스트',
    dt: new Date().toISOString(),
  });
}

function _findAlarmTodoItem(todoId){
  if (_alarmMiniWidgetId) {
    const w = _widgetGridState?.widgets?.find((x) => x.id === _alarmMiniWidgetId);
    return w?.items?.find((t) => t.id === todoId) || null;
  }
  return todoItems.find((t) => t.id === todoId) || null;
}

/* ── 투두 알림 미니 팝업 ── */
function openAlarmMiniPopup(todoId, btnEl, widgetId){
  _alarmMiniTarget = todoId;
  _alarmMiniWidgetId = widgetId || null;
  const item = _findAlarmTodoItem(todoId);
  if(!item) return;

  document.getElementById('ampItemText').textContent = item.text;

  if(item.alarmDT){
    setAmpDt(item.alarmDT.slice(0,16));
  } else {
    const _d = new Date();
    const _p  = n => String(n).padStart(2,'0');
    setAmpDt(`${_d.getFullYear()}-${_p(_d.getMonth()+1)}-${_p(_d.getDate())}T${_p(_d.getHours())}:${_p(_d.getMinutes())}`);
  }

  const clearBtn = document.getElementById('ampClearBtn');
  clearBtn.disabled = !item.alarmDT;

  // 팝업 위치 계산
  const popup = document.getElementById('alarmMiniPopup');
  popup.style.display = 'block';
  const rect = btnEl.getBoundingClientRect();
  const popH = 155, popW = 290;
  const top  = (rect.bottom + 8 + popH > window.innerHeight) ? rect.top - popH - 4 : rect.bottom + 8;
  const left = Math.min(Math.max(rect.left - popW/2, 8), window.innerWidth - popW - 8);
  popup.style.top  = top  + 'px';
  popup.style.left = left + 'px';
  popup.classList.add('amp-open');
  document.getElementById('alarmMiniOverlay').style.display = 'block';
}

function closeAlarmMiniPopup(){
  const popup = document.getElementById('alarmMiniPopup');
  popup.classList.remove('amp-open');
  popup.style.display = '';   // 인라인 style 초기화 → CSS class(display:none)가 적용되도록
  document.getElementById('alarmMiniOverlay').style.display = 'none';
  _alarmMiniTarget = null;
  _alarmMiniWidgetId = null;
}

function saveAlarmMiniPopup(){
  const id = _alarmMiniTarget;
  const dt = document.getElementById('ampDtInput').value;
  if(!id || !dt){ showToast('⚠️ 알림 시간을 선택해주세요'); return; }
  // datetime-local은 분 단위 — 60초 이상 과거만 거부 (현재 분은 허용)
  if (parseLocalDateTime(dt) < Date.now() - 60000) { showToast('⚠️ 이미 지난 시간이에요'); return; }

  const item = _findAlarmTodoItem(id);
  if(!item) return;
  item.alarmDT = dt;
  if (_alarmMiniWidgetId) {
    void saveState(_widgetGridState);
    renderTodoListForWidget(_alarmMiniWidgetId);
  } else {
    saveLegacyAppData();
    renderTodoList();
  }
  closeAlarmMiniPopup();
  const d = new Date(dt);
  showToast('🔔 알림 설정 — ' + d.toLocaleString('ko-KR', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }));
}

function clearAlarmMiniPopup(){
  const id = _alarmMiniTarget;
  const widgetId = _alarmMiniWidgetId;
  const item = _findAlarmTodoItem(id);
  if (item) {
    item.alarmDT = '';
    if (widgetId) {
      void saveState(_widgetGridState);
      renderTodoListForWidget(widgetId);
    } else {
      saveLegacyAppData();
      renderTodoList();
    }
  }
  closeAlarmMiniPopup();
  showToast('🔕 알림이 해제됐어요');
}

/* ── 캘린더 이벤트 다이얼로그 — 알림 토글 ── */
function evdToggleAlarm(){
  const chk  = document.getElementById('evdAlarmChk');
  const wrap = document.getElementById('evdAlarmDtWrap');
  const dtEl = document.getElementById('evdAlarmDT');
  if(chk.checked){
    wrap.style.display = '';
    if(!dtEl.value){
      const dateStr = document.getElementById('evdDate').value;
      const timeStr = document.getElementById('evdStartTime').value || '09:00';
      if(dateStr) setEvAlarmDT(`${dateStr}T${timeStr}`);
    }
  } else {
    wrap.style.display = 'none';
    dtEl.value = '';
    updateDtChipPair('evdAlarmDateChip', 'evdAlarmTimeChip', '');
  }
}

/* ── 초기 설정 Step1 — Google 로그인 ── */
(function setupAuthUpdateListener(){
  onAuthUpdate(function(msg){
    const log = document.getElementById('authStatusLog');
    if(log){ log.style.display = 'block'; log.textContent = msg; }
    // 인증 성공 시 대시보드 Google 상태 즉시 갱신 (설정창 재연결 포함)
    if(msg && msg.includes('연결 성공')){
      _googleProfileCache = null;
      updateGoogleChip(true);
      updateSettingsGoogleStatus(true);
      if(typeof checkGoogleAuth === 'function') checkGoogleAuth();
    }
  });
})();

async function doSetupGoogleConnect(){
  const btn = document.getElementById('setupConnBtn');
  const log = document.getElementById('authStatusLog');
  function setLog(msg){ if(log){ log.style.display='block'; log.textContent=msg; } }
  function hideLog(){ if(log){ log.style.display='none'; log.textContent=''; } }

  if(btn){ btn.disabled = true; btn.textContent = '연결 중...'; }

  setLog('🔑 브라우저 열기 중...');

  try {
    const r = await googleAuthStart();

    if(r?.success){
      hideLog();
      setSetupConnected();
      showToast('✅ Google 계정 연결 완료!');
      _googleProfileCache = null;
      updateGoogleChip(true);
      syncCalendarSilent();
      // 1.2초 후 자동으로 다음 스텝
      setTimeout(() => nextSetupStep(), 1200);
    } else {
      const errMsg = r?.error || '알 수 없는 오류';
      setLog('❌ 연결 실패: ' + errMsg);
      showToast('❌ 연결 실패 — ' + errMsg);
      resetSetupConnBtn();
    }
  } catch(e) {
    console.error('googleAuthStart error:', e);
    setLog('❌ 오류: ' + e.message);
    showToast('❌ 오류: ' + e.message);
    resetSetupConnBtn();
  }
}

/* Step1 연결 성공 UI */
function setSetupConnected(){
  const dot = document.getElementById('setupConnDot');
  const txt = document.getElementById('setupConnTxt');
  const btn = document.getElementById('setupConnBtn');
  if(dot){ dot.style.background = '#22c55e'; dot.style.boxShadow = '0 0 6px rgba(34,197,94,0.6)'; }
  if(txt){ txt.textContent = '연결 완료 ✅'; txt.style.color = '#16a34a'; txt.style.fontWeight = '600'; }
  if(btn){ btn.style.display = 'none'; }
}

/* 버튼 원상 복구 */
function resetSetupConnBtn(){
  const btn = document.getElementById('setupConnBtn');
  if(!btn) return;
  btn.disabled = false;
  btn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" '
    + 'style="width:18px;height:18px;vertical-align:middle;margin-right:8px" onerror="this.style.display=\'none\'">'
    + 'Google 계정으로 로그인';
}

/* Step1 진입 시 기존 토큰 확인 → 이미 연결돼 있으면 자동 표시 */
async function checkSetupAuthStatus(){
  const s = await getAuthStatus();
  if(s?.authenticated) setSetupConnected();
}

/* ════════════════════════════════════════════════════════════════
   시작 시 모든 오버레이/팝업 강제 초기화
   이전 세션 잔여 상태나 권한 오류로 인해 오버레이가 열린 채
   남아 있으면 전체 화면 클릭이 막히므로 무조건 닫는다.
════════════════════════════════════════════════════════════════ */
(function resetAllOverlaysOnStart() {
  try {
    // ev-dialog-overlay 계열 (position:fixed inset:0 z-index:950 — 전체 화면 차단)
    ['drvMoveOverlay', 'evDialog'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('evd-open');
    });
    // display / class 방식 오버레이
    ['cevCtxOverlay', 'cevCtxMenu'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('cev-open');
    });
    document.getElementById('drvCtxOverlay')?.classList.remove('drv-open');
    document.getElementById('drvCtxMenu')?.classList.remove('drv-open');
    document.getElementById('icpOverlay')?.classList.remove('icp-open');
    ['drvMovePanel', 'renameOverlay', 'renamePopup', 'icpPopup',
     'alarmMiniOverlay'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const uo = document.getElementById('updateOverlay');
    if (uo) { uo.classList.remove('uo-show'); uo.style.display = ''; }
    document.getElementById('updateBanner')?.classList.remove('ub-show');
    document.getElementById('widgetTypePicker')?.classList.remove('open');
    document.getElementById('widgetSourceDialog')?.classList.remove('open');
    // class 방식 팝업
    const cep = document.getElementById('catEditPopup');
    if (cep) cep.classList.remove('cep-open');
    const alarm = document.getElementById('alarmOverlay');
    if (alarm) alarm.classList.remove('alarm-show');
    const settings = document.getElementById('settingsOverlay');
    if (settings) settings.classList.remove('sp-open');
  } catch(e) {}
})();

/* ════════════════════════════════════════════════════════════════
   type="module" 전역 노출 블록
   onclick="xxx()" 등 HTML 인라인 이벤트 핸들러가 참조하는 함수를
   window 에 등록한다 (ES 모듈은 기본적으로 전역이 아니기 때문).
════════════════════════════════════════════════════════════════ */
Object.assign(window, {
  // ── 외부 URL 열기 / 창 제어 ──
  openPath, hideToTray, showDesktopPeek, snapToCurrentMonitor,
  pickFilesForCategory, pickFolderForCategory,
  // ── 배율 / UI ──
  adjustScale, applySettings, setScalePreset,
  spScalePreset, spScaleInput, onSetupSliderInput, onSfSlider, toggleScaleFloater,
  selCat, selRes, spSelRes,
  // ── 캘린더 ──
  calMove, calReset, doSync, buildCalendar, renderCal, renderCalEvents, syncGcalToWindow, setGcalEvents,
  openEvDialog, saveEvDialog, closeEvDialog, openGoogleCalendar,
  evdToggleAllDay, evdToggleAlarm,
  cevCtxEdit, cevCtxDelete, closeCevCtx,
  // ── 설정 패널 ──
  openSettings, closeSettings, reopenSetup,
  switchSpTab, spAddCat, saveCatEditPopup, closeCatEditPopup,
  confirmIconPicker, closeIconPicker,
  setCepType, icpStartCapture, icpToggleCustomMenu, icpTriggerUpload, icpHandleFile,
  // ── Drive ──
  driveRefresh, driveNext, drivePrev,
  drvCtxOpen, drvCtxDownload, drvCtxTrash, drvCtxMove,
  closeDrvCtx, closeDrvMove, confirmDrvMove,
  openWeeklyDriveFolder,
  // ── Todo / Tasks ──
  addTodoItem, clearDoneTodos, syncGoogleTasks,
  // ── 알람 ──
  saveAlarmMiniPopup, clearAlarmMiniPopup, closeAlarmMiniPopup,
  dismissAlarmNotif, triggerTestAlarmForQA, focusWindow,
  // ── 카테고리 / 아이콘 피커 ──
  buildCatPanels, showIconPicker, reorderCatsPanelsForTest,
  // ── Google 연결 ──
  doGoogleConnect, doGoogleDisconnect,
  doSetupGoogleConnect, doCheckForUpdates, checkForUpdates, installUpdate,
  // ── 설정 초기화 / 앱 ──
  resetAllData, quitApp,
  // ── 이름 변경 ──
  confirmRename, closeRenamePopup,
  // ── Setup 스텝 ──
  nextSetupStep, prevSetupStep, launchDashboard,
  // ── 자동 시작 ──
  setAutoLaunch,
  // ── Weekly Plan / 라이트박스 ──
  startEditWeeklyTitle, saveWeeklyTitle, weeklyTitleKey,
  // ── 업데이트 배너 ──
  onUbBtnClick,
});

window.__dashReady = true;
document.documentElement.classList.replace('dash-booting', 'dash-ready');
_bindSetupUiOnce();

/* 앱 시작 시 setupDone 이면 대시보드 — 반드시 Object.assign 이후 */
(async function checkSetupDone(){
  let done = localStorage.getItem('setupDone') === '1';
  if (!done) {
    try {
      const st = await loadState();
      if (st?.settings?.setupDone) {
        localStorage.setItem('setupDone', '1');
        done = true;
      }
    } catch (_) {}
  }
  if (!done) return;
  document.getElementById('setupOverlay').classList.add('hidden');
  document.getElementById('dashboard').classList.add('show');
  applyScale(userScale);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboard, { once: true });
  } else {
    initDashboard();
  }
})();
