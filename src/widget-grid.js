/**
 * widget-grid.js — 정적 위젯 그리드 렌더 (단계 4: 편집 OFF)
 */
import { GRID_COLS } from './layout-engine.js';

/** 기본 OFF — localStorage USE_WIDGET_GRID=1 이면 ON */
export const USE_WIDGET_GRID_DEFAULT = false;

export const DEFAULT_GAP = 8;

export function isWidgetGridEnabled() {
  if (typeof localStorage !== 'undefined') {
    const v = localStorage.getItem('USE_WIDGET_GRID');
    if (v === '1' || v === 'true') return true;
  }
  return USE_WIDGET_GRID_DEFAULT;
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
  if (type === 'calendar' || type === 'drive' || type === 'todo') {
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

/**
 * @param {HTMLElement} container
 * @param {object} state
 * @param {{ gap?: number, cellSize?: number, anchors?: object, editable?: boolean, layoutOnly?: boolean }} [options]
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

  let canvas = container.querySelector(':scope > .widget-grid-canvas');
  if (!canvas && layoutOnly) return { cellSize, gap, cols };

  if (!canvas) {
    canvas = document.createElement('div');
    canvas.className = 'widget-grid-canvas';
    container.innerHTML = '';
    container.appendChild(canvas);
  }

  canvas.style.height = `${computeGridHeight(widgets, cellSize, gap)}px`;

  const typeIndex = { calendar: 0, drive: 0, todo: 0, category: 0 };
  const categoryCount = countCategoryWidgets(widgets);
  const widgetById = new Map(widgets.map((w) => [w.id, w]));

  if (layoutOnly) {
    canvas.querySelectorAll('.widget-cell').forEach((shell) => {
      const widget = widgetById.get(shell.dataset.widgetId);
      if (widget) applyShellGeometry(shell, widget, cellSize, gap);
    });
    return { cellSize, gap, cols };
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

  return { cellSize, gap, cols };
}

/** DOM에서 기존 4종 패널 앵커 수집 (buildCatPanels 이후 호출) */
export function collectPanelAnchors() {
  if (typeof document === 'undefined') {
    return { calendar: [], drive: [], todo: [], catZone: null, categoryPanels: [] };
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
  const resolvedAnchors = anchors ?? collectPanelAnchors();

  renderGrid(rootEl, state, { anchors: resolvedAnchors, editable: false });

  let raf = 0;
  const onResize = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      renderGrid(rootEl, state, {
        anchors: resolvedAnchors,
        editable: false,
        layoutOnly: true,
      });
    });
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onResize);
  }

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', onResize);
    }
    cancelAnimationFrame(raf);
  };
}
