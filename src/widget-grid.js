/**
 * widget-grid.js — 위젯 그리드 렌더 + 편집 + ResizeObserver 반응형 (단계 7)
 */
import {
  GRID_COLS,
  moveElement,
  resizeElement,
  pixelToCell,
} from './layout-engine.js';

/** 기본 OFF — localStorage USE_WIDGET_GRID=1 이면 ON */
export const USE_WIDGET_GRID_DEFAULT = false;

export const DEFAULT_GAP = 8;

let _contentSyncPaused = false;
let _editMode = false;
let _mounted = null;
let _editTeardown = null;
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

const LOCAL_WIDGET_TYPES = ['clock', 'sticky', 'pomodoro', 'dday'];

export function setContentSyncPaused(v) {
  _contentSyncPaused = !!v;
}

export function isContentSyncPaused() {
  return _contentSyncPaused;
}

export function isEditMode() {
  return _editMode;
}

export function isLayoutDirty() {
  return _layoutDirty;
}

export function isWidgetGridEnabled() {
  if (typeof localStorage !== 'undefined') {
    const v = localStorage.getItem('USE_WIDGET_GRID');
    if (v === '1' || v === 'true') return true;
  }
  return USE_WIDGET_GRID_DEFAULT;
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
    const minCol = categoryMinColForTier(tier);
    const grid = `repeat(auto-fill, minmax(${minCol}px, 1fr))`;
    const catZone = shell.querySelector(':scope > .cat-zone');
    if (catZone) {
      catZone.style.gridTemplateColumns = grid;
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
  if (!isWidgetGridEnabled()) return;
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

function countCategoryWidgets(widgets) {
  return widgets.filter((w) => w.type === 'category').length;
}

function resolveAnchorNode(widget, anchors, typeIndex, categoryCount) {
  const type = widget.type;
  if (type === 'calendar' || type === 'drive' || type === 'todo'
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

function applyWidgetsGeometry(canvas, widgets, metrics) {
  if (!canvas) return;
  const widgetById = new Map(widgets.map((w) => [w.id, w]));
  canvas.querySelectorAll('.widget-cell').forEach((shell) => {
    const w = widgetById.get(shell.dataset.widgetId);
    if (w) applyShellGeometry(shell, w, metrics.cellSize, metrics.gap);
  });
  canvas.style.height = `${computeGridHeight(widgets, metrics.cellSize, metrics.gap)}px`;
}

function updateAllShellGeometry(container, state, metrics) {
  const canvas = getCanvas(container);
  if (!canvas) return;
  const widgets = Array.isArray(state?.widgets) ? state.widgets : [];
  applyWidgetsGeometry(canvas, widgets, metrics);
}

function ensureDragHandles(canvas) {
  canvas.querySelectorAll('.widget-cell').forEach((shell) => {
    if (!shell.querySelector(':scope > .widget-drag-handle')) {
      const handle = document.createElement('div');
      handle.className = 'widget-drag-handle';
      handle.setAttribute('aria-label', '위젯 이동');
      handle.innerHTML = '<span class="widget-drag-grip"></span><span class="widget-drag-label">이동</span>';
      shell.insertBefore(handle, shell.firstChild);
    }
  });
}

function removeDragHandles(canvas) {
  canvas.querySelectorAll('.widget-drag-handle').forEach((h) => h.remove());
}

function ensureResizeHandles(canvas) {
  canvas.querySelectorAll('.widget-cell').forEach((shell) => {
    if (!shell.querySelector(':scope > .widget-resize-handle')) {
      const handle = document.createElement('div');
      handle.className = 'widget-resize-handle';
      handle.setAttribute('aria-label', '위젯 크기 조절');
      handle.innerHTML = '<span class="widget-resize-grip">↘</span>';
      shell.appendChild(handle);
    }
  });
}

function removeResizeHandles(canvas) {
  canvas.querySelectorAll('.widget-resize-handle').forEach((h) => h.remove());
}

function getOrCreateGhost(canvas) {
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
  const ghost = getOrCreateGhost(canvas);
  applyShellGeometry(ghost, widget, metrics.cellSize, metrics.gap);
  ghost.style.display = 'block';
}

function clearDragVisuals(canvas) {
  canvas?.querySelectorAll('.widget-cell.is-dragging').forEach((shell) => {
    shell.classList.remove('is-dragging');
  });
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

  const nextLayout = moveElement(layout, item, cell.x, cell.y);
  const nextWidgets = applyLayoutToWidgets(state.widgets, nextLayout);
  state.widgets = nextWidgets;
  _layoutDirty = true;

  updateAllShellGeometry(container, state, metrics);
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

  const previewLayout = moveElement(layout, item, cell.x, cell.y);
  const previewWidgets = applyLayoutToWidgets(state.widgets, previewLayout);

  const canvas = getCanvas(container);
  if (!canvas) return;
  applyWidgetsGeometry(canvas, previewWidgets, metrics);
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

  const nextLayout = resizeElement(layout, item, newW, newH);
  const nextWidgets = applyLayoutToWidgets(state.widgets, nextLayout);
  state.widgets = nextWidgets;
  _layoutDirty = true;

  const canvas = getCanvas(container);
  if (canvas) hideResizeGhost(canvas);
  updateAllShellGeometry(container, state, metrics);
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

  const previewLayout = resizeElement(layout, item, newW, newH);
  const previewWidgets = applyLayoutToWidgets(state.widgets, previewLayout);

  const canvas = getCanvas(container);
  if (!canvas) return;
  applyWidgetsGeometry(canvas, previewWidgets, metrics);

  const resized = previewWidgets.find((w) => w.id === widgetId);
  if (resized) showResizeGhost(canvas, resized, metrics);
}

function attachDragHandlers(container, state) {
  const canvas = getCanvas(container);
  if (!canvas) return () => {};

  const handles = [...canvas.querySelectorAll('.widget-drag-handle')];
  const cleanups = [];

  const onPointerDown = (e) => {
    if (!_editMode || _resizeSession || e.button !== 0) return;
    const handle = e.currentTarget;
    const shell = handle.closest('.widget-cell');
    const widgetId = shell?.dataset?.widgetId;
    if (!widgetId || !shell) return;

    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);

    const metrics = renderGrid(container, state, { layoutOnly: true });
    _dragSession = {
      pointerId: e.pointerId,
      widgetId,
      shell,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      deltaX: 0,
      deltaY: 0,
      metrics,
      raf: 0,
      pending: false,
    };
    shell.classList.add('is-dragging');
  };

  const schedulePreview = () => {
    if (!_dragSession || _dragSession.pending) return;
    _dragSession.pending = true;
    _dragSession.raf = requestAnimationFrame(() => {
      if (!_dragSession) return;
      _dragSession.pending = false;
      previewDrag(state, container, _dragSession);
    });
  };

  const onPointerMove = (e) => {
    if (!_dragSession || _dragSession.pointerId !== e.pointerId) return;
    _dragSession.deltaX = e.clientX - _dragSession.startX;
    _dragSession.deltaY = e.clientY - _dragSession.startY;
    schedulePreview();
  };

  const finishPointer = (e) => {
    if (!_dragSession || _dragSession.pointerId !== e.pointerId) return;
    const session = _dragSession;
    _dragSession = null;
    cancelAnimationFrame(session.raf);

    try {
      session.handle.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* already released */
    }

    session.shell.classList.remove('is-dragging');
    commitDrag(state, container, session);
  };

  const onPointerUp = (e) => finishPointer(e);
  const onPointerCancel = (e) => {
    if (!_dragSession || _dragSession.pointerId !== e.pointerId) return;
    const session = _dragSession;
    _dragSession = null;
    cancelAnimationFrame(session.raf);
    session.shell.classList.remove('is-dragging');
    updateAllShellGeometry(container, state, session.metrics);
  };

  for (const handle of handles) {
    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerCancel);
    cleanups.push(() => {
      handle.removeEventListener('pointerdown', onPointerDown);
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerCancel);
    });
  }

  return () => {
    for (const fn of cleanups) fn();
    if (_dragSession) {
      cancelAnimationFrame(_dragSession.raf);
      _dragSession = null;
    }
    clearDragVisuals(canvas);
  };
}

function attachResizeHandlers(container, state) {
  const canvas = getCanvas(container);
  if (!canvas) return () => {};

  const handles = [...canvas.querySelectorAll('.widget-resize-handle')];
  const cleanups = [];

  const onPointerDown = (e) => {
    if (!_editMode || _dragSession || e.button !== 0) return;
    const handle = e.currentTarget;
    const shell = handle.closest('.widget-cell');
    const widgetId = shell?.dataset?.widgetId;
    if (!widgetId || !shell) return;

    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);

    const metrics = renderGrid(container, state, { layoutOnly: true });
    _resizeSession = {
      pointerId: e.pointerId,
      widgetId,
      shell,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      deltaX: 0,
      deltaY: 0,
      metrics,
      raf: 0,
      pending: false,
    };
    shell.classList.add('is-resizing');
  };

  const schedulePreview = () => {
    if (!_resizeSession || _resizeSession.pending) return;
    _resizeSession.pending = true;
    _resizeSession.raf = requestAnimationFrame(() => {
      if (!_resizeSession) return;
      _resizeSession.pending = false;
      previewResize(state, container, _resizeSession);
    });
  };

  const onPointerMove = (e) => {
    if (!_resizeSession || _resizeSession.pointerId !== e.pointerId) return;
    _resizeSession.deltaX = e.clientX - _resizeSession.startX;
    _resizeSession.deltaY = e.clientY - _resizeSession.startY;
    schedulePreview();
  };

  const finishPointer = (e) => {
    if (!_resizeSession || _resizeSession.pointerId !== e.pointerId) return;
    const session = _resizeSession;
    _resizeSession = null;
    cancelAnimationFrame(session.raf);

    try {
      session.handle.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* already released */
    }

    session.shell.classList.remove('is-resizing');
    commitResize(state, container, session);
  };

  const onPointerUp = (e) => finishPointer(e);
  const onPointerCancel = (e) => {
    if (!_resizeSession || _resizeSession.pointerId !== e.pointerId) return;
    const session = _resizeSession;
    _resizeSession = null;
    cancelAnimationFrame(session.raf);
    session.shell.classList.remove('is-resizing');
    hideResizeGhost(canvas);
    updateAllShellGeometry(container, state, session.metrics);
  };

  for (const handle of handles) {
    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerCancel);
    cleanups.push(() => {
      handle.removeEventListener('pointerdown', onPointerDown);
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerCancel);
    });
  }

  return () => {
    for (const fn of cleanups) fn();
    if (_resizeSession) {
      cancelAnimationFrame(_resizeSession.raf);
      _resizeSession = null;
    }
    clearResizeVisuals(canvas);
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

  const typeIndex = {
    calendar: 0, drive: 0, todo: 0, category: 0,
    clock: 0, sticky: 0, pomodoro: 0, dday: 0,
  };
  const categoryCount = countCategoryWidgets(widgets);
  const widgetById = new Map(widgets.map((w) => [w.id, w]));

  if (layoutOnly) {
    canvas.querySelectorAll('.widget-cell').forEach((shell) => {
      const widget = widgetById.get(shell.dataset.widgetId);
      if (widget) applyShellGeometry(shell, widget, cellSize, gap);
    });
    return metrics;
  }

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

  if (_editMode) {
    ensureDragHandles(canvas);
    ensureResizeHandles(canvas);
  }

  return metrics;
}

function ensureEditActionButtons(canvas, options = {}) {
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
      clock: [], sticky: [], pomodoro: [], dday: [],
      catZone: null, categoryPanels: [],
    };
  }
  const pool = document.getElementById('widgetAnchorPool');
  if (pool && state?.widgets) {
    const calendar = [];
    const drive = [];
    const todo = [];
    const clock = [];
    const sticky = [];
    const pomodoro = [];
    const dday = [];
    for (const w of state.widgets) {
      const node = pool.querySelector(`[data-widget-id="${w.id}"]`);
      if (!node) continue;
      if (w.type === 'calendar') calendar.push(node);
      else if (w.type === 'drive') drive.push(node);
      else if (w.type === 'todo') todo.push(node);
      else if (w.type === 'clock') clock.push(node);
      else if (w.type === 'sticky') sticky.push(node);
      else if (w.type === 'pomodoro') pomodoro.push(node);
      else if (w.type === 'dday') dday.push(node);
    }
    const catZone = document.getElementById('catZone');
    const categoryPanels = catZone ? [...catZone.querySelectorAll(':scope > .cat-panel')] : [];
    return {
      calendar, drive, todo, clock, sticky, pomodoro, dday, catZone, categoryPanels,
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
 * @returns {() => void} teardown
 */
export function mountWidgetGrid(rootEl, state, anchors = null) {
  detachWidgetObservers();
  if (_editTeardown) {
    _editTeardown();
    _editTeardown = null;
  }
  _editMode = false;
  _layoutDirty = false;
  _dragSession = null;
  _resizeSession = null;

  const resolvedAnchors = anchors ?? collectPanelAnchors();
  const metrics = renderGrid(rootEl, state, { anchors: resolvedAnchors });

  _mounted = { rootEl, state, anchors: resolvedAnchors, metrics };
  attachWidgetObservers(rootEl);

  let raf = 0;
  const onResize = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!_mounted) return;
      renderGrid(rootEl, state, {
        anchors: resolvedAnchors,
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
 * @returns {() => void}
 */
export function remountWidgetGrid(rootEl, state, anchors = null, prevTeardown = null) {
  if (typeof prevTeardown === 'function') prevTeardown();
  return mountWidgetGrid(rootEl, state, anchors);
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
  setContentSyncPaused(true);
  ensureDragHandles(canvas);
  ensureResizeHandles(canvas);
  ensureEditActionButtons(canvas, options);

  const dashboard = typeof document !== 'undefined'
    ? document.getElementById('dashboard')
    : null;
  if (dashboard) dashboard.classList.add('widget-grid-editing');

  if (_editTeardown) _editTeardown();

  const dragTeardown = attachDragHandlers(rootEl, state);
  const resizeTeardown = attachResizeHandlers(rootEl, state);

  const onKeyDown = (e) => {
    if (e.key === 'Escape' && _editMode && typeof options.onEsc === 'function') {
      options.onEsc();
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown);
  }

  _editTeardown = () => {
    dragTeardown();
    resizeTeardown();
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
    removeDragHandles(canvas);
    removeResizeHandles(canvas);
    removeEditActionButtons(canvas);
    updateAllShellGeometry(rootEl, state, renderGrid(rootEl, state, { layoutOnly: true }));
  }

  _editMode = false;
  setContentSyncPaused(false);

  const dashboard = typeof document !== 'undefined'
    ? document.getElementById('dashboard')
    : null;
  if (dashboard) dashboard.classList.remove('widget-grid-editing');

  if (_mounted) _mounted.state = state;
  return state;
}
