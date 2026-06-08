/**
 * widget-grid.js — 위젯 그리드 렌더 + 편집 + ResizeObserver 반응형 (단계 7)
 */
import {
  GRID_COLS,
  compactLayout,
  compactVertical,
  moveElement,
  resizeElement,
  pixelToCell,
} from './layout-engine.js';

/** 단계 15: 그리드가 유일 레이아웃 */
export const USE_WIDGET_GRID_DEFAULT = true;

export const DEFAULT_GAP = 8;

let _contentSyncPaused = false;
let _editMode = false;
let _focusWidgetId = null;
let _mounted = null;
let _editTeardown = null;
let _entryTeardown = null;
let _dragSession = null;
let _resizeSession = null;
let _layoutDirty = false;
let _observerRegistry = null;

/** tier breakpoint (width·height px) — RESULT §6 참조 */
export const TIER_WIDTH_COMPACT = 220;
export const TIER_WIDTH_SPACIOUS = 380;
export const TIER_HEIGHT_COMPACT = 180;
export const TIER_HEIGHT_SPACIOUS = 260;

const CATEGORY_MINMAX = { compact: 100, normal: 140, spacious: 180 };

const LOCAL_WIDGET_TYPES = ['clock', 'sticky', 'pomodoro', 'dday', 'weather', 'gemini'];

export function setContentSyncPaused(v) {
  _contentSyncPaused = !!v;
}

export function isContentSyncPaused() {
  return _contentSyncPaused;
}

export function isEditMode() {
  return _editMode;
}

export function getEditFocusWidgetId() {
  return _focusWidgetId;
}

export function isLayoutDirty() {
  return _layoutDirty;
}

export function isWidgetGridEnabled() {
  return true;
}

export function widgetsToLayout(widgets) {
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

export function applyLayoutToWidgets(widgets, layout) {
  if (!Array.isArray(widgets) || !Array.isArray(layout)) return widgets;
  const byId = new Map(layout.map((el) => [el.i, el]));
  return widgets.map((w) => {
    const el = byId.get(w.id);
    if (!el) return { ...w };
    return { ...w, x: el.x, y: el.y, w: el.w, h: el.h };
  });
}

/** 셀 치수 → 픽셀 (applyShellGeometry 와 동일) */
export function cellsToPixelSize(w, h, cellSize, gap = DEFAULT_GAP) {
  const pw = w * cellSize + (w - 1) * gap;
  const ph = h * cellSize + (h - 1) * gap;
  return { pw, ph };
}

/** 픽셀 크기 → 셀 수 역산 (스냅) */
export function pixelSizeToCells(pw, ph, cellSize, gap = DEFAULT_GAP) {
  const stride = cellSize + gap;
  if (stride <= 0) return { w: 1, h: 1 };
  const w = Math.max(1, Math.round((Math.max(0, pw) + gap) / stride));
  const h = Math.max(1, Math.round((Math.max(0, ph) + gap) / stride));
  return { w, h };
}

/** 셸 크기 → 반응형 tier (compact | normal | spacious) */
export function computeResponsiveTier(width, height) {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  if (w < TIER_WIDTH_COMPACT || h < TIER_HEIGHT_COMPACT) return 'compact';
  if (w >= TIER_WIDTH_SPACIOUS && h >= TIER_HEIGHT_SPACIOUS) return 'spacious';
  return 'normal';
}

/** tier별 카테고리 auto-fill minmax(px) */
export function categoryMinColForTier(tier) {
  return CATEGORY_MINMAX[tier] ?? CATEGORY_MINMAX.normal;
}

/**
 * @param {HTMLElement} shell
 * @param {string} type
 * @param {number} width
 * @param {number} height
 */
export function applyWidgetResponsive(shell, type, width, height) {
  if (!shell) return;
  const tier = computeResponsiveTier(width, height);
  shell.dataset.widgetTier = tier;
  shell.style.setProperty('--widget-w', `${Math.round(width)}px`);
  shell.style.setProperty('--widget-h', `${Math.round(height)}px`);

  if (type === 'category') {
    const catZone = shell.querySelector(':scope > .cat-zone');
    if (catZone) {
      const count = Math.max(1, catZone.querySelectorAll(':scope > .cat-panel').length);
      catZone.style.gridTemplateColumns = `repeat(${count}, 1fr)`;
    }
  }
}

function observeShellResize(shell) {
  const type = shell.dataset.widgetType || 'calendar';
  const w = shell.clientWidth;
  const h = shell.clientHeight;
  if (w > 0 && h > 0) {
    applyWidgetResponsive(shell, type, w, h);
  }
}

/** @param {HTMLElement} rootEl */
export function attachWidgetObservers(rootEl) {
  detachWidgetObservers();

  const canvas = getCanvas(rootEl);
  if (!canvas || typeof ResizeObserver === 'undefined') return;

  const observers = new Map();
  const rafPending = new Map();

  for (const shell of canvas.querySelectorAll('.widget-cell')) {
    observeShellResize(shell);

    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target;
        const prev = rafPending.get(target);
        if (prev) cancelAnimationFrame(prev);
        rafPending.set(target, requestAnimationFrame(() => {
          rafPending.delete(target);
          const cr = entry.contentRect;
          const w = cr.width > 0 ? cr.width : target.clientWidth;
          const h = cr.height > 0 ? cr.height : target.clientHeight;
          applyWidgetResponsive(
            target,
            target.dataset.widgetType || 'calendar',
            w,
            h,
          );
          if (target.dataset.widgetType === 'calendar'
            && typeof globalThis.__dashboardRerenderCalendar === 'function') {
            globalThis.__dashboardRerenderCalendar(target.dataset.widgetId);
          }
        }));
      }
    });
    obs.observe(shell);
    observers.set(shell, obs);
  }

  _observerRegistry = { observers, rafPending };
}

export function detachWidgetObservers() {
  if (!_observerRegistry) return;
  for (const [, obs] of _observerRegistry.observers) {
    obs.disconnect();
  }
  for (const raf of _observerRegistry.rafPending.values()) {
    cancelAnimationFrame(raf);
  }
  _observerRegistry = null;
}

export function computeCellSize(containerWidth, cols, gap = DEFAULT_GAP) {
  const safeCols = cols > 0 ? cols : GRID_COLS;
  const safeWidth = Math.max(containerWidth, safeCols * 40);
  return Math.floor((safeWidth - gap * (safeCols - 1)) / safeCols);
}

export function computeGridHeight(widgets, cellSize, gap = DEFAULT_GAP) {
  let max = 0;
  for (const w of widgets) {
    const y = w.y ?? 0;
    const h = w.h ?? 1;
    const bottom = (y + h) * (cellSize + gap) - gap;
    if (bottom > max) max = bottom;
  }
  return Math.max(max, cellSize);
}

function applyShellGeometry(shell, widget, cellSize, gap) {
  const x = widget.x ?? 0;
  const y = widget.y ?? 0;
  const w = widget.w ?? 2;
  const h = widget.h ?? 2;
  const px = x * (cellSize + gap);
  const py = y * (cellSize + gap);
  const pw = w * cellSize + (w - 1) * gap;
  const ph = h * cellSize + (h - 1) * gap;
  shell.style.transform = `translate(${px}px, ${py}px)`;
  shell.style.width = `${pw}px`;
  shell.style.height = `${ph}px`;
}

function applyShellGeometryWithOffset(shell, widget, cellSize, gap, offsetX, offsetY) {
  const x = widget.x ?? 0;
  const y = widget.y ?? 0;
  const w = widget.w ?? 2;
  const h = widget.h ?? 2;
  const px = x * (cellSize + gap) + offsetX;
  const py = y * (cellSize + gap) + offsetY;
  const pw = w * cellSize + (w - 1) * gap;
  const ph = h * cellSize + (h - 1) * gap;
  shell.style.transform = `translate(${px}px, ${py}px)`;
  shell.style.width = `${pw}px`;
  shell.style.height = `${ph}px`;
}

function applyShellPixelSize(shell, widget, cellSize, gap, pw, ph) {
  const x = widget.x ?? 0;
  const y = widget.y ?? 0;
  const px = x * (cellSize + gap);
  const py = y * (cellSize + gap);
  shell.style.transform = `translate(${px}px, ${py}px)`;
  shell.style.width = `${pw}px`;
  shell.style.height = `${ph}px`;
}

function countCategoryWidgets(widgets) {
  return widgets.filter((w) => w.type === 'category').length;
}

function resolveAnchorNode(widget, anchors, typeIndex, categoryCount) {
  const type = widget.type;
  if (type === 'calendar' || type === 'drive' || type === 'todo'
    || type === 'gsheets' || type === 'gslides' || type === 'gdocs'
    || LOCAL_WIDGET_TYPES.includes(type)) {
    const list = anchors[type] || [];
    const node = list[typeIndex[type] ?? 0];
    if (node) typeIndex[type] = (typeIndex[type] ?? 0) + 1;
    return node || null;
  }
  if (type === 'category') {
    const idx = (typeIndex.category ?? 0);
    typeIndex.category = idx + 1;
    if (categoryCount === 1 && anchors.catZone) {
      return anchors.catZone;
    }
    const m = /^cat-(\d+)$/.exec(widget.id || '');
    if (m && anchors.categoryPanels) {
      const panelIdx = parseInt(m[1], 10) - 1;
      if (anchors.categoryPanels[panelIdx]) {
        return anchors.categoryPanels[panelIdx];
      }
    }
    if (anchors.categoryPanels && anchors.categoryPanels[idx]) {
      return anchors.categoryPanels[idx];
    }
    if (idx === 0 && anchors.catZone) return anchors.catZone;
  }
  return null;
}

function getCanvas(container) {
  return container?.querySelector(':scope > .widget-grid-canvas') ?? null;
}

function setCanvasInteracting(canvas, active) {
  if (!canvas) return;
  canvas.classList.toggle('is-interacting', !!active);
}

function suppressReflowTransition(canvas) {
  if (!canvas) return;
  canvas.classList.add('no-reflow-transition');
  if (typeof requestAnimationFrame !== 'function') {
    canvas.classList.remove('no-reflow-transition');
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      canvas.classList.remove('no-reflow-transition');
    });
  });
}

function applyWidgetsGeometry(canvas, widgets, metrics, options = {}) {
  if (!canvas) return;
  if (options.suppressTransition) suppressReflowTransition(canvas);
  const widgetById = new Map(widgets.map((w) => [w.id, w]));
  canvas.querySelectorAll('.widget-cell').forEach((shell) => {
    const w = widgetById.get(shell.dataset.widgetId);
    if (w) applyShellGeometry(shell, w, metrics.cellSize, metrics.gap);
  });
  canvas.style.height = `${computeGridHeight(widgets, metrics.cellSize, metrics.gap)}px`;
}

function updateAllShellGeometry(container, state, metrics, options = {}) {
  const canvas = getCanvas(container);
  if (!canvas) return;
  const widgets = Array.isArray(state?.widgets) ? state.widgets : [];
  applyWidgetsGeometry(canvas, widgets, metrics, options);
}

function clearWidgetLayoutEditing(canvas) {
  canvas?.querySelectorAll('.widget-layout-editing').forEach((el) => {
    el.classList.remove('widget-layout-editing');
  });
}

/** iOS 제어센터 스타일 — 우하단 구름/유리 코너 핸들 */
function cornerGripMarkup() {
  return `<svg class="widget-corner-grip" viewBox="0 0 40 40" aria-hidden="true">
    <defs>
      <linearGradient id="wg-grip-grad" x1="100%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.92)"/>
        <stop offset="55%" stop-color="rgba(236,232,255,0.78)"/>
        <stop offset="100%" stop-color="rgba(196,181,253,0.55)"/>
      </linearGradient>
    </defs>
    <path class="widget-corner-grip-arc" d="M34 6 C34 20 20 34 6 34" fill="none" stroke="url(#wg-grip-grad)" stroke-width="3.2" stroke-linecap="round"/>
    <path class="widget-corner-grip-shine" d="M32 10 C32 21 21 32 10 32" fill="none" stroke="rgba(255,255,255,0.95)" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`;
}

function ensureWidgetGestureZones(canvas) {
  canvas.querySelectorAll('.widget-cell').forEach((shell) => {
    if (!shell.querySelector(':scope > .widget-move-zone')) {
      const moveZone = document.createElement('div');
      moveZone.className = 'widget-move-zone';
      moveZone.setAttribute('aria-label', '위젯 이동');
      moveZone.title = '꾹 눌러 끌어 이동';
      shell.insertBefore(moveZone, shell.firstChild);
    }
    if (shell.querySelector(':scope > .widget-corner-zone')) return;
    const zone = document.createElement('div');
    zone.className = 'widget-corner-zone';
    zone.setAttribute('aria-label', '위젯 크기 조절');
    zone.title = '드래그하여 크기 조절';
    zone.innerHTML = cornerGripMarkup();
    shell.appendChild(zone);
  });
}

function getOrCreateResizeGhost(canvas) {
  let ghost = canvas.querySelector(':scope > .widget-resize-ghost');
  if (!ghost) {
    ghost = document.createElement('div');
    ghost.className = 'widget-resize-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    canvas.appendChild(ghost);
  }
  return ghost;
}

function hideResizeGhost(canvas) {
  const ghost = canvas?.querySelector(':scope > .widget-resize-ghost');
  if (ghost) ghost.style.display = 'none';
}

function showResizeGhost(canvas, widget, metrics) {
  const ghost = getOrCreateResizeGhost(canvas);
  applyShellGeometry(ghost, widget, metrics.cellSize, metrics.gap);
  ghost.style.display = 'block';
}

function getOrCreateDragGhost(canvas) {
  let ghost = canvas.querySelector(':scope > .widget-drag-ghost');
  if (!ghost) {
    ghost = document.createElement('div');
    ghost.className = 'widget-drag-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    canvas.appendChild(ghost);
  }
  return ghost;
}

function hideDragGhost(canvas) {
  const ghost = canvas?.querySelector(':scope > .widget-drag-ghost');
  if (ghost) ghost.style.display = 'none';
}

function showDragGhost(canvas, widget, metrics) {
  const ghost = getOrCreateDragGhost(canvas);
  applyShellGeometry(ghost, widget, metrics.cellSize, metrics.gap);
  ghost.style.display = 'block';
}

function scheduleSettledGeometry(container, state, metrics) {
  const apply = () => updateAllShellGeometry(container, state, metrics);
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      requestAnimationFrame(apply);
    });
  } else {
    apply();
  }
}

function clearDragVisuals(canvas) {
  canvas?.querySelectorAll('.widget-cell.is-dragging').forEach((shell) => {
    shell.classList.remove('is-dragging');
  });
  hideDragGhost(canvas);
}

function clearResizeVisuals(canvas) {
  canvas?.querySelectorAll('.widget-cell.is-resizing').forEach((shell) => {
    shell.classList.remove('is-resizing');
  });
  hideResizeGhost(canvas);
}

function commitDrag(state, container, session) {
  const { widgetId, deltaX, deltaY, metrics } = session;
  const widget = state.widgets.find((w) => w.id === widgetId);
  if (!widget) return state;

  const stride = metrics.cellSize + metrics.gap;
  const startPx = (widget.x ?? 0) * stride;
  const startPy = (widget.y ?? 0) * stride;
  const cell = pixelToCell(startPx + deltaX, startPy + deltaY, metrics.cellSize, metrics.gap);

  const layout = widgetsToLayout(state.widgets);
  const item = layout.find((el) => el.i === widgetId);
  if (!item) return state;

  // 가로 컴팩션(compactHorizontal)은 사용자가 의도적으로 옮긴 열(x) 위치를 무시하고
  // 왼쪽 빈칸으로 다시 당겨버려 "원하는 자리에 못 놓는" 문제를 일으킨다.
  // 드래그 이동은 충돌 처리 + 세로 빈칸 제거만 적용해 사용자가 고른 위치를 보존한다.
  const nextLayout = compactVertical(moveElement(layout, item, cell.x, cell.y));
  const nextWidgets = applyLayoutToWidgets(state.widgets, nextLayout);
  state.widgets = nextWidgets;
  _layoutDirty = true;

  const canvas = getCanvas(container);
  hideDragGhost(canvas);
  scheduleSettledGeometry(container, state, metrics);
  if (_mounted) _mounted.state = state;
  return state;
}

function previewDrag(state, container, session) {
  const { widgetId, deltaX, deltaY, metrics } = session;
  const widget = state.widgets.find((w) => w.id === widgetId);
  if (!widget) return;

  const stride = metrics.cellSize + metrics.gap;
  const startPx = (widget.x ?? 0) * stride;
  const startPy = (widget.y ?? 0) * stride;
  const cell = pixelToCell(startPx + deltaX, startPy + deltaY, metrics.cellSize, metrics.gap);

  const layout = widgetsToLayout(state.widgets);
  const item = layout.find((el) => el.i === widgetId);
  if (!item) return;

  const previewLayout = compactVertical(moveElement(layout, item, cell.x, cell.y));
  const previewWidgets = applyLayoutToWidgets(state.widgets, previewLayout);

  const canvas = getCanvas(container);
  if (!canvas) return;

  const previewById = new Map(previewWidgets.map((w) => [w.id, w]));
  canvas.querySelectorAll('.widget-cell').forEach((shell) => {
    const id = shell.dataset.widgetId;
    const previewW = previewById.get(id);
    if (!previewW) return;
    if (id === widgetId) {
      applyShellGeometryWithOffset(shell, widget, metrics.cellSize, metrics.gap, deltaX, deltaY);
    } else {
      applyShellGeometry(shell, previewW, metrics.cellSize, metrics.gap);
    }
  });
  canvas.style.height = `${computeGridHeight(previewWidgets, metrics.cellSize, metrics.gap)}px`;

  const target = previewWidgets.find((w) => w.id === widgetId);
  if (target) showDragGhost(canvas, target, metrics);
}

function computeResizeCells(widget, deltaX, deltaY, metrics) {
  const { pw: startPw, ph: startPh } = cellsToPixelSize(
    widget.w ?? 2,
    widget.h ?? 2,
    metrics.cellSize,
    metrics.gap,
  );
  return pixelSizeToCells(
    startPw + deltaX,
    startPh + deltaY,
    metrics.cellSize,
    metrics.gap,
  );
}

function commitResize(state, container, session) {
  const { widgetId, deltaX, deltaY, metrics } = session;
  const widget = state.widgets.find((w) => w.id === widgetId);
  if (!widget) return state;

  const { w: newW, h: newH } = computeResizeCells(widget, deltaX, deltaY, metrics);
  const layout = widgetsToLayout(state.widgets);
  const item = layout.find((el) => el.i === widgetId);
  if (!item) return state;

  const nextLayout = compactLayout(resizeElement(layout, item, newW, newH));
  const nextWidgets = applyLayoutToWidgets(state.widgets, nextLayout);
  state.widgets = nextWidgets;
  _layoutDirty = true;

  const canvas = getCanvas(container);
  hideResizeGhost(canvas);
  scheduleSettledGeometry(container, state, metrics);
  if (_mounted) _mounted.state = state;
  return state;
}

function previewResize(state, container, session) {
  const { widgetId, deltaX, deltaY, metrics } = session;
  const widget = state.widgets.find((w) => w.id === widgetId);
  if (!widget) return;

  const { w: newW, h: newH } = computeResizeCells(widget, deltaX, deltaY, metrics);
  const layout = widgetsToLayout(state.widgets);
  const item = layout.find((el) => el.i === widgetId);
  if (!item) return;

  const previewLayout = compactLayout(resizeElement(layout, item, newW, newH));
  const previewWidgets = applyLayoutToWidgets(state.widgets, previewLayout);

  const canvas = getCanvas(container);
  if (!canvas) return;

  const { pw: startPw, ph: startPh } = cellsToPixelSize(
    widget.w ?? 2,
    widget.h ?? 2,
    metrics.cellSize,
    metrics.gap,
  );
  const smoothPw = Math.max(metrics.cellSize, startPw + deltaX);
  const smoothPh = Math.max(metrics.cellSize, startPh + deltaY);

  const previewById = new Map(previewWidgets.map((w) => [w.id, w]));
  canvas.querySelectorAll('.widget-cell').forEach((shell) => {
    const id = shell.dataset.widgetId;
    const previewW = previewById.get(id);
    if (!previewW) return;
    if (id === widgetId) {
      applyShellPixelSize(shell, widget, metrics.cellSize, metrics.gap, smoothPw, smoothPh);
    } else {
      applyShellGeometry(shell, previewW, metrics.cellSize, metrics.gap);
    }
  });
  canvas.style.height = `${computeGridHeight(previewWidgets, metrics.cellSize, metrics.gap)}px`;

  const resized = previewWidgets.find((w) => w.id === widgetId);
  if (resized) showResizeGhost(canvas, resized, metrics);
}

const RESIZE_DRAG_THRESHOLD = 6;
const MOVE_DRAG_THRESHOLD = 6;  // 롱프레스 제거 — 움직임 감지 즉시 드래그
const MOVE_CANCEL_SLOP = 10;

function beginGestureEdit(container, state, widgetId, hooks) {
  if (_editMode) return;
  enterEditMode(container, state, {
    focusWidgetId: widgetId,
    onEsc: hooks?.onEsc,
    onSettings: hooks?.onSettings,
    onDelete: hooks?.onDelete,
  });
  const canvas = getCanvas(container);
  const shell = canvas?.querySelector(`.widget-cell[data-widget-id="${widgetId}"]`);
  if (shell) shell.classList.add('widget-layout-editing');
  if (typeof navigator.vibrate === 'function') navigator.vibrate(12);
}

async function endGestureEdit(container, state, hooks, { save = true } = {}) {
  if (!_editMode) return;
  if (save && typeof hooks?.onSessionEnd === 'function') {
    await hooks.onSessionEnd();
  }
  exitEditMode(container, state);
  clearWidgetLayoutEditing(getCanvas(container));
}

/** 우하단 드래그=크기 조절, 상단 길게 누르기+드래그=이동 — 한 제스처로 진입·저장·종료 */
function attachWidgetGestureHandlers(container, state, hooks = {}) {
  const canvas = getCanvas(container);
  if (!canvas) return () => {};

  let resizeLocal = null;
  let moveLocal = null;

  const scheduleResizePreview = () => {
    if (!_resizeSession || _resizeSession.pending) return;
    _resizeSession.pending = true;
    _resizeSession.raf = requestAnimationFrame(() => {
      if (!_resizeSession) return;
      _resizeSession.pending = false;
      previewResize(state, container, _resizeSession);
    });
  };

  const scheduleDragPreview = () => {
    if (!_dragSession || _dragSession.pending) return;
    _dragSession.pending = true;
    _dragSession.raf = requestAnimationFrame(() => {
      if (!_dragSession) return;
      _dragSession.pending = false;
      previewDrag(state, container, _dragSession);
    });
  };

  const finishResize = async (e) => {
    if (!resizeLocal || (e && resizeLocal.pointerId !== e.pointerId)) return;
    const local = resizeLocal;
    resizeLocal = null;

    try { local.zone.releasePointerCapture(local.pointerId); } catch (_) {}

    if (local.started && _resizeSession) {
      const session = _resizeSession;
      _resizeSession = null;
      cancelAnimationFrame(session.raf);
      session.shell.classList.remove('is-resizing');
      setCanvasInteracting(canvas, false);
      commitResize(state, container, session);
      await endGestureEdit(container, state, hooks, { save: true });
    } else {
      local.zone.classList.remove('is-active');
    }
  };

  const finishMove = async (e) => {
    if (!moveLocal || (e && moveLocal.pointerId !== e.pointerId)) return;
    const local = moveLocal;
    moveLocal = null;
    clearTimeout(local.timer);

    try { local.zone.releasePointerCapture(local.pointerId); } catch (_) {}

    if (local.armed && _dragSession) {
      const session = _dragSession;
      _dragSession = null;
      cancelAnimationFrame(session.raf);
      session.shell.classList.remove('is-dragging');
      setCanvasInteracting(canvas, false);
      commitDrag(state, container, session);
      await endGestureEdit(container, state, hooks, { save: true });
    } else if (local.armed) {
      await endGestureEdit(container, state, hooks, { save: false });
    }
    local.zone.classList.remove('is-active');
  };

  const onResizeDown = (e) => {
    if (_editMode || _resizeSession || _dragSession || e.button !== 0) return;
    const zone = e.target.closest('.widget-corner-zone');
    if (!zone || !canvas.contains(zone)) return;
    const shell = zone.closest('.widget-cell');
    const widgetId = shell?.dataset?.widgetId;
    if (!widgetId) return;

    e.preventDefault();
    e.stopPropagation();
    zone.setPointerCapture(e.pointerId);
    zone.classList.add('is-active');

    resizeLocal = {
      pointerId: e.pointerId,
      widgetId,
      shell,
      zone,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
    };
  };

  const onResizeMove = (e) => {
    if (!resizeLocal || resizeLocal.pointerId !== e.pointerId) return;
    const dx = e.clientX - resizeLocal.startX;
    const dy = e.clientY - resizeLocal.startY;
    if (!resizeLocal.started) {
      if (Math.hypot(dx, dy) < RESIZE_DRAG_THRESHOLD) return;
      resizeLocal.started = true;
      beginGestureEdit(container, state, resizeLocal.widgetId, hooks);
      const metrics = renderGrid(container, state, { layoutOnly: true });
      setCanvasInteracting(canvas, true);
      resizeLocal.shell.classList.add('is-resizing');
      _resizeSession = {
        pointerId: e.pointerId,
        widgetId: resizeLocal.widgetId,
        shell: resizeLocal.shell,
        handle: resizeLocal.zone,
        startX: resizeLocal.startX,
        startY: resizeLocal.startY,
        deltaX: dx,
        deltaY: dy,
        metrics,
        raf: 0,
        pending: false,
      };
      previewResize(state, container, _resizeSession);
      return;
    }
    if (!_resizeSession) return;
    _resizeSession.deltaX = dx;
    _resizeSession.deltaY = dy;
    scheduleResizePreview();
  };

  const onMoveDown = (e) => {
    if (_editMode || _resizeSession || _dragSession || e.button !== 0) return;
    const zone = e.target.closest('.widget-move-zone');
    if (!zone || !canvas.contains(zone)) return;
    const shell = zone.closest('.widget-cell');
    const widgetId = shell?.dataset?.widgetId;
    if (!widgetId) return;

    zone.style.pointerEvents = 'none';
    const below = document.elementFromPoint(e.clientX, e.clientY);
    zone.style.pointerEvents = '';
    if (below && below !== zone && shell.contains(below)) {
      const clickable = below.closest('button, a, [role="button"], .nb, .ch-nav, .widget-action-btn');
      if (clickable) {
        // 이동존(상단 띠)에 가려진 버튼을 직접 실행해 클릭이 먹게 한다.
        e.preventDefault();
        clickable.click();
        return;
      }
      if (below.closest('input, textarea, select, label')) {
        return;   // 입력류 위에서는 드래그를 시작하지 않는다.
      }
    }

    zone.setPointerCapture(e.pointerId);
    zone.classList.add('is-active');

    moveLocal = {
      pointerId: e.pointerId,
      widgetId,
      shell,
      zone,
      startX: e.clientX,
      startY: e.clientY,
      armed: true,   // 즉시 활성화 (롱프레스 없음)
      dragging: false,
      timer: null,
    };
  };

  const onMoveMove = (e) => {
    if (!moveLocal || moveLocal.pointerId !== e.pointerId) return;
    const dx = e.clientX - moveLocal.startX;
    const dy = e.clientY - moveLocal.startY;

    if (!moveLocal.dragging) {
      if (Math.hypot(dx, dy) < MOVE_DRAG_THRESHOLD) return;
      moveLocal.dragging = true;
      beginGestureEdit(container, state, moveLocal.widgetId, hooks);
      const metrics = renderGrid(container, state, { layoutOnly: true });
      setCanvasInteracting(canvas, true);
      moveLocal.shell.classList.add('is-dragging');
      _dragSession = {
        pointerId: e.pointerId,
        widgetId: moveLocal.widgetId,
        shell: moveLocal.shell,
        handle: moveLocal.zone,
        startX: moveLocal.startX,
        startY: moveLocal.startY,
        deltaX: dx,
        deltaY: dy,
        metrics,
        raf: 0,
        pending: false,
      };
      previewDrag(state, container, _dragSession);
      return;
    }

    if (!_dragSession) return;
    _dragSession.deltaX = dx;
    _dragSession.deltaY = dy;
    scheduleDragPreview();
  };

  const onPointerUp = (e) => {
    if (resizeLocal?.pointerId === e.pointerId) void finishResize(e);
    if (moveLocal?.pointerId === e.pointerId) void finishMove(e);
  };

  const onPointerCancel = (e) => {
    if (resizeLocal?.pointerId === e.pointerId) {
      if (resizeLocal.started) {
        const session = _resizeSession;
        _resizeSession = null;
        if (session) cancelAnimationFrame(session.raf);
        resizeLocal.shell?.classList.remove('is-resizing');
        clearResizeVisuals(canvas);
        setCanvasInteracting(canvas, false);
        void endGestureEdit(container, state, hooks, { save: false });
      }
      resizeLocal = null;
    }
    if (moveLocal?.pointerId === e.pointerId) {
      clearTimeout(moveLocal.timer);
      if (moveLocal.armed) {
        const session = _dragSession;
        _dragSession = null;
        if (session) cancelAnimationFrame(session.raf);
        moveLocal.shell?.classList.remove('is-dragging');
        clearDragVisuals(canvas);
        setCanvasInteracting(canvas, false);
        void endGestureEdit(container, state, hooks, { save: false });
      }
      moveLocal = null;
    }
  };

  canvas.addEventListener('pointerdown', onResizeDown);
  canvas.addEventListener('pointerdown', onMoveDown);
  canvas.addEventListener('pointermove', onResizeMove);
  canvas.addEventListener('pointermove', onMoveMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);

  return () => {
    canvas.removeEventListener('pointerdown', onResizeDown);
    canvas.removeEventListener('pointerdown', onMoveDown);
    canvas.removeEventListener('pointermove', onResizeMove);
    canvas.removeEventListener('pointermove', onMoveMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    if (resizeLocal) void finishResize();
    if (moveLocal) void finishMove();
  };
}

/**
 * @param {HTMLElement} container
 * @param {object} state
 * @param {{ gap?: number, cellSize?: number, anchors?: object, layoutOnly?: boolean }} [options]
 */
export function renderGrid(container, state, options = {}) {
  const cols = state?.grid?.cols ?? GRID_COLS;
  const gap = options.gap ?? DEFAULT_GAP;
  const widgets = Array.isArray(state?.widgets) ? state.widgets : [];
  const anchors = options.anchors ?? {};
  const layoutOnly = options.layoutOnly === true;

  container.classList.add('widget-grid');
  const width = container.clientWidth || container.offsetWidth || 800;
  const cellSize = options.cellSize ?? computeCellSize(width, cols, gap);
  const metrics = { cellSize, gap, cols };

  let canvas = getCanvas(container);
  if (!canvas && layoutOnly) return metrics;

  if (!canvas) {
    canvas = document.createElement('div');
    canvas.className = 'widget-grid-canvas';
    container.innerHTML = '';
    container.appendChild(canvas);
  }

  canvas.style.height = `${computeGridHeight(widgets, cellSize, gap)}px`;
  if (_editMode) {
    canvas.style.setProperty('--edit-grid-step', `${cellSize + gap}px`);
  }

  const typeIndex = {
    calendar: 0, drive: 0, todo: 0, gsheets: 0, gslides: 0, gdocs: 0, category: 0,
    clock: 0, sticky: 0, pomodoro: 0, dday: 0, weather: 0, gemini: 0,
  };
  const categoryCount = countCategoryWidgets(widgets);
  const widgetById = new Map(widgets.map((w) => [w.id, w]));

  if (layoutOnly) {
    applyWidgetsGeometry(canvas, widgets, metrics, { suppressTransition: true });
    return metrics;
  }

  suppressReflowTransition(canvas);
  canvas.innerHTML = '';
  for (const widget of widgets) {
    const shell = document.createElement('div');
    shell.className = 'widget-cell';
    shell.dataset.widgetId = widget.id;
    shell.dataset.widgetType = widget.type;
    applyShellGeometry(shell, widget, cellSize, gap);

    const node = resolveAnchorNode(widget, anchors, typeIndex, categoryCount);
    if (node) shell.appendChild(node);

    canvas.appendChild(shell);
  }

  ensureWidgetGestureZones(canvas);

  return metrics;
}

function ensureEditActionButtons(canvas, options = {}) {
  const focusWidgetId = options.focusWidgetId ?? null;
  if (focusWidgetId) return;
  canvas.querySelectorAll('.widget-cell').forEach((shell) => {
    if (shell.querySelector(':scope > .widget-edit-actions')) return;
    const bar = document.createElement('div');
    bar.className = 'widget-edit-actions';
    const wid = shell.dataset.widgetId;
    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'widget-action-btn widget-action-settings';
    settingsBtn.title = '소스 설정';
    settingsBtn.textContent = '⚙';
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof options.onSettings === 'function') options.onSettings(wid);
    });
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'widget-action-btn widget-action-delete';
    delBtn.title = '위젯 삭제';
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof options.onDelete === 'function') options.onDelete(wid);
    });
    bar.appendChild(settingsBtn);
    bar.appendChild(delBtn);
    shell.appendChild(bar);
  });
}

function removeEditActionButtons(canvas) {
  canvas.querySelectorAll('.widget-edit-actions').forEach((el) => el.remove());
}

/** DOM에서 기존 4종 패널 앵커 수집 (buildCatPanels·syncWidgetAnchors 이후 호출) */
export function collectPanelAnchors(state = null) {
  if (typeof document === 'undefined') {
    return {
      calendar: [], drive: [], todo: [],
      gsheets: [], gslides: [], gdocs: [],
      clock: [], sticky: [], pomodoro: [], dday: [], weather: [], gemini: [],
      catZone: null, categoryPanels: [],
    };
  }
  const pool = document.getElementById('widgetAnchorPool');
  if (pool && state?.widgets) {
    const calendar = [];
    const drive = [];
    const todo = [];
    const gsheets = [];
    const gslides = [];
    const gdocs = [];
    const clock = [];
    const sticky = [];
    const pomodoro = [];
    const dday = [];
    const weather = [];
    const gemini = [];
    for (const w of state.widgets) {
      const node = pool.querySelector(`[data-widget-id="${w.id}"]`);
      if (!node) continue;
      if (w.type === 'calendar') calendar.push(node);
      else if (w.type === 'drive') drive.push(node);
      else if (w.type === 'todo') todo.push(node);
      else if (w.type === 'gsheets') gsheets.push(node);
      else if (w.type === 'gslides') gslides.push(node);
      else if (w.type === 'gdocs') gdocs.push(node);
      else if (w.type === 'clock') clock.push(node);
      else if (w.type === 'sticky') sticky.push(node);
      else if (w.type === 'pomodoro') pomodoro.push(node);
      else if (w.type === 'dday') dday.push(node);
      else if (w.type === 'weather') weather.push(node);
      else if (w.type === 'gemini') gemini.push(node);
    }
    const catZone = document.getElementById('catZone');
    const categoryPanels = catZone ? [...catZone.querySelectorAll(':scope > .cat-panel')] : [];
    return {
      calendar, drive, todo, gsheets, gslides, gdocs,
      clock, sticky, pomodoro, dday, weather, gemini, catZone, categoryPanels,
    };
  }
  const sideL = document.querySelector('.side-l');
  const gcs = sideL ? [...sideL.querySelectorAll(':scope > .gc')] : [];
  const catZone = document.getElementById('catZone');
  const categoryPanels = catZone ? [...catZone.querySelectorAll(':scope > .cat-panel')] : [];
  return {
    calendar: gcs[0] ? [gcs[0]] : [],
    drive: gcs[1] ? [gcs[1]] : [],
    todo: gcs[2] ? [gcs[2]] : [],
    catZone: catZone || null,
    categoryPanels,
  };
}

/**
 * @param {HTMLElement} rootEl
 * @param {object} state
 * @param {object} [anchors]
 * @param {{ onEnterEdit?: (id: string) => void }} [hooks]
 * @returns {() => void} teardown
 */
export function mountWidgetGrid(rootEl, state, anchors = null, hooks = {}) {
  detachWidgetObservers();
  if (_editTeardown) {
    _editTeardown();
    _editTeardown = null;
  }
  if (_entryTeardown) {
    _entryTeardown();
    _entryTeardown = null;
  }
  _editMode = false;
  _layoutDirty = false;
  _dragSession = null;
  _resizeSession = null;

  const resolvedAnchors = anchors ?? collectPanelAnchors();
  const metrics = renderGrid(rootEl, state, { anchors: resolvedAnchors });

  _mounted = { rootEl, state, anchors: resolvedAnchors, metrics };
  attachWidgetObservers(rootEl);
  _entryTeardown = attachWidgetGestureHandlers(rootEl, state, hooks);

  let raf = 0;
  const onResize = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!_mounted) return;
      renderGrid(rootEl, _mounted.state, {
        anchors: _mounted.anchors ?? resolvedAnchors,
        layoutOnly: true,
      });
    });
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onResize);
  }

  return () => {
    detachWidgetObservers();
    if (_editTeardown) {
      _editTeardown();
      _editTeardown = null;
    }
    if (_entryTeardown) {
      _entryTeardown();
      _entryTeardown = null;
    }
    _editMode = false;
    _dragSession = null;
    _resizeSession = null;
    _mounted = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', onResize);
    }
    cancelAnimationFrame(raf);
  };
}

/**
 * @param {HTMLElement} rootEl
 * @param {object} state
 * @param {object} [anchors]
 * @param {() => void} [prevTeardown]
 * @param {{ onEnterEdit?: (id: string) => void }} [hooks]
 * @returns {() => void}
 */
export function remountWidgetGrid(rootEl, state, anchors = null, prevTeardown = null, hooks = {}) {
  if (typeof prevTeardown === 'function') prevTeardown();
  return mountWidgetGrid(rootEl, state, anchors, hooks);
}

/** 위젯 삭제 등 경량 DOM 갱신 — 셸 제거 후 레이아웃만 재계산 */
export function pruneWidgetCell(rootEl, state, widgetId, anchors = null) {
  const canvas = getCanvas(rootEl);
  if (!canvas) return state;
  canvas.querySelector(`.widget-cell[data-widget-id="${widgetId}"]`)?.remove();
  const resolvedAnchors = anchors ?? collectPanelAnchors(state);
  renderGrid(rootEl, state, { anchors: resolvedAnchors, layoutOnly: true });
  if (_mounted) {
    _mounted.state = state;
    _mounted.anchors = resolvedAnchors;
  }
  return state;
}

/**
 * @param {HTMLElement} rootEl
 * @param {object} state
 * @param {{ onEsc?: () => void, onSettings?: (id:string)=>void, onDelete?: (id:string)=>void }} [options]
 */
export function enterEditMode(rootEl, state, options = {}) {
  if (_editMode) return state;
  const canvas = getCanvas(rootEl);
  if (!canvas) return state;

  _editMode = true;
  _focusWidgetId = options.focusWidgetId ?? null;
  setContentSyncPaused(true);
  ensureEditActionButtons(canvas, options);

  const dashboard = typeof document !== 'undefined'
    ? document.getElementById('dashboard')
    : null;
  if (dashboard) dashboard.classList.add('widget-grid-editing');

  renderGrid(rootEl, state, { layoutOnly: true });

  const onKeyDown = (e) => {
    if (e.key === 'Escape' && _editMode && typeof options.onEsc === 'function') {
      options.onEsc();
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown);
  }

  if (_editTeardown) _editTeardown();
  _editTeardown = () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onKeyDown);
    }
  };

  if (_mounted) _mounted.state = state;
  return state;
}

/**
 * @param {HTMLElement} rootEl
 * @param {object} state
 */
export function exitEditMode(rootEl, state) {
  if (!_editMode) return state;

  if (_dragSession) {
    cancelAnimationFrame(_dragSession.raf);
    _dragSession = null;
  }
  if (_resizeSession) {
    cancelAnimationFrame(_resizeSession.raf);
    _resizeSession = null;
  }

  if (_editTeardown) {
    _editTeardown();
    _editTeardown = null;
  }

  const canvas = getCanvas(rootEl);
  if (canvas) {
    clearDragVisuals(canvas);
    clearResizeVisuals(canvas);
    removeEditActionButtons(canvas);
    clearWidgetLayoutEditing(canvas);
    updateAllShellGeometry(
      rootEl,
      state,
      renderGrid(rootEl, state, { layoutOnly: true }),
      { suppressTransition: true },
    );
    setCanvasInteracting(canvas, false);
  }

  _editMode = false;
  _focusWidgetId = null;
  setContentSyncPaused(false);

  const dashboard = typeof document !== 'undefined'
    ? document.getElementById('dashboard')
    : null;
  if (dashboard) dashboard.classList.remove('widget-grid-editing');

  if (_mounted) _mounted.state = state;
  return state;
}
