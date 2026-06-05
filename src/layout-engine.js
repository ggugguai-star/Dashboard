/**
 * layout-engine.js — 순수 그리드 레이아웃 엔진
 * react-grid-layout compact/collision 미러. DOM/async/Date/random 사용 금지.
 */

export const GRID_COLS = 12;

function cloneLayout(layout) {
  return layout.map((el) => ({ ...el }));
}

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

/**
 * 충돌 아이템을 밀어냄: 동일 행(y)이면 가로(x+w), 아니면 세로(y+h) push-down.
 * 연쇄 충돌은 큐로 반복 해소.
 */
export function resolveCollisionsCascade(layout, moved) {
  const result = cloneLayout(layout);
  const movedIdx = result.findIndex((el) => el.i === moved.i);
  if (movedIdx >= 0) {
    result[movedIdx] = { ...moved };
  }

  const queue = [moved.i];
  const seen = new Set();

  while (queue.length > 0) {
    const anchorId = queue.shift();
    if (seen.has(anchorId)) continue;
    seen.add(anchorId);

    const anchor = result.find((el) => el.i === anchorId);
    if (!anchor) continue;

    for (let i = 0; i < result.length; i++) {
      if (result[i].i === anchorId) continue;
      if (!collides(anchor, result[i])) continue;

      const other = { ...result[i] };
      if (other.y === anchor.y) {
        other.x = anchor.x + anchor.w;
      } else {
        other.y = anchor.y + anchor.h;
      }
      result[i] = other;
      queue.push(other.i);
    }
  }

  return result;
}

/**
 * 위쪽 빈 공간 제거 — y 오름차순·x 오름차순 처리, 가능한 최소 y로 당김.
 * 입력 배열 순서는 유지해 반환.
 */
export function compactVertical(layout) {
  if (layout.length === 0) return [];

  const items = cloneLayout(layout);
  const order = items.map((el) => el.i);
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

  for (const item of sorted) {
    for (let y = 0; y <= item.y; y++) {
      const probe = { ...item, y };
      const blocked = sorted.some(
        (other) => other.i !== item.i && collides(probe, other),
      );
      if (!blocked) {
        item.y = y;
        break;
      }
    }
  }

  return order.map((id) => {
    const found = sorted.find((el) => el.i === id);
    return { ...found };
  });
}

/**
 * 12열 그리드에 위젯을 가로·세로로 빈 칸에 배치 (first-fit, 큰 것 우선).
 * 세로 한 줄 스택 대신 한 화면에 최대한 모이도록 배치한다.
 */
export function packLayoutFirstFit(layout, cols = GRID_COLS) {
  if (!layout.length) return [];
  const order = layout.map((el) => el.i);
  const sorted = [...layout].sort((a, b) => {
    const areaA = (a.w ?? 1) * (a.h ?? 1);
    const areaB = (b.w ?? 1) * (b.h ?? 1);
    if (areaB !== areaA) return areaB - areaA;
    return String(a.i).localeCompare(String(b.i));
  });

  const placed = [];
  const maxScanY = 96;

  for (const item of sorted) {
    const w = Math.min(item.w ?? 1, cols);
    const h = item.h ?? 1;
    let spot = null;

    outer:
    for (let y = 0; y < maxScanY; y++) {
      for (let x = 0; x <= cols - w; x++) {
        const probe = { ...item, x, y, w, h };
        if (!placed.some((p) => collides(probe, p))) {
          spot = { x, y };
          break outer;
        }
      }
    }

    if (!spot) {
      const fallbackY = placed.reduce((m, p) => Math.max(m, (p.y ?? 0) + (p.h ?? 1)), 0);
      spot = { x: 0, y: fallbackY };
    }

    placed.push({ ...item, x: spot.x, y: spot.y, w, h });
  }

  return order.map((id) => {
    const found = placed.find((el) => el.i === id);
    return found ? { ...found } : null;
  }).filter(Boolean);
}

export function moveElement(layout, item, x, y) {
  const base = cloneLayout(layout);
  const idx = base.findIndex((el) => el.i === item.i);
  if (idx < 0) return base;

  const moved = clampToBounds({ ...base[idx], x, y });
  base[idx] = moved;
  return resolveCollisionsCascade(base, moved);
}

export function resizeElement(layout, item, w, h) {
  const base = cloneLayout(layout);
  const idx = base.findIndex((el) => el.i === item.i);
  if (idx < 0) return base;

  const current = base[idx];
  const minW = current.minW ?? 1;
  const minH = current.minH ?? 1;
  const moved = clampToBounds({
    ...current,
    w: Math.max(w, minW),
    h: Math.max(h, minH),
  });
  base[idx] = moved;
  return resolveCollisionsCascade(base, moved);
}

/** 픽셀 좌표 → 그리드 셀 (gap 포함 stride). */
export function pixelToCell(px, py, cell, gap) {
  const stride = cell + gap;
  if (stride <= 0) return { x: 0, y: 0 };
  const safePx = px < 0 ? 0 : px;
  const safePy = py < 0 ? 0 : py;
  return {
    x: Math.floor(safePx / stride),
    y: Math.floor(safePy / stride),
  };
}

/** x/y/w/h를 그리드 경계·minW/minH 내로 클램프. */
export function clampToBounds(item, cols = GRID_COLS) {
  const out = { ...item };
  const minW = out.minW ?? 1;
  const minH = out.minH ?? 1;
  if (out.w < minW) out.w = minW;
  if (out.h < minH) out.h = minH;
  if (out.w > cols) {
    out.w = cols;
    out.x = 0;
  }
  if (out.x < 0) out.x = 0;
  if (out.y < 0) out.y = 0;
  if (out.x + out.w > cols) out.x = cols - out.w;
  if (out.x < 0) {
    out.x = 0;
    out.w = cols;
  }
  return out;
}
