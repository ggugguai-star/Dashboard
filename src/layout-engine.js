/**
 * layout-engine.js — 순수 그리드 레이아웃 엔진 (단계 1: API 스텁)
 * DOM/async/Date/random 사용 금지. 단계 2에서 move/resize/compact/cascade 전면 구현.
 */

export const GRID_COLS = 12;

/** react-grid-layout collides: 겹치는 면적이 있을 때만 true (인접은 false). */
export function collides(a, b) {
  if (a.i === b.i) return false;
  if (a.x + a.w <= b.x) return false;
  if (a.x >= b.x + b.w) return false;
  if (a.y + a.h <= b.y) return false;
  if (a.y >= b.y + b.h) return false;
  return true;
}

export function getCollisions(layout, item) {
  return layout.filter((other) => other.i !== item.i && collides(item, other));
}

/** 단계 2 구현 예정 — 현재는 레이아웃 얕은 복사만 반환. */
export function moveElement(layout, item, x, y) {
  return layout.map((el) => ({ ...el }));
}

/** 단계 2 구현 예정 — 현재는 레이아웃 얕은 복사만 반환. */
export function resizeElement(layout, item, w, h) {
  return layout.map((el) => ({ ...el }));
}

/** 단계 2 구현 예정 — 현재는 레이아웃 얕은 복사만 반환. */
export function compactVertical(layout) {
  return layout.map((el) => ({ ...el }));
}

/** 단계 2 구현 예정 — 현재는 레이아웃 얕은 복사만 반환. */
export function resolveCollisionsCascade(layout, moved) {
  return layout.map((el) => ({ ...el }));
}

/** 픽셀 좌표 → 그리드 셀 (gap 포함 stride). */
export function pixelToCell(px, py, cell, gap) {
  const stride = cell + gap;
  return {
    x: Math.floor(px / stride),
    y: Math.floor(py / stride),
  };
}

/** x/y/w/h를 그리드 경계·minW/minH 내로 클램프. */
export function clampToBounds(item, cols = GRID_COLS) {
  const out = { ...item };
  const minW = out.minW ?? 1;
  const minH = out.minH ?? 1;
  if (out.w < minW) out.w = minW;
  if (out.h < minH) out.h = minH;
  if (out.x < 0) out.x = 0;
  if (out.y < 0) out.y = 0;
  if (out.x + out.w > cols) out.x = cols - out.w;
  if (out.x < 0) {
    out.x = 0;
    out.w = cols;
  }
  return out;
}
