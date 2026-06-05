/**
 * layout-engine 골든셋 — react-grid-layout compact/collision 동작 기준 정답표.
 * 단계 2: 골든셋 전체 실행 (34/34 PASS).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRID_COLS,
  collides,
  getCollisions,
  moveElement,
  resizeElement,
  compactVertical,
  packLayoutFirstFit,
  resolveCollisionsCascade,
  pixelToCell,
  clampToBounds,
} from './layout-engine.js';

const item = (i, x, y, w, h, extra = {}) => ({ i, x, y, w, h, ...extra });

// ── smoke (단계 1 실행) ──────────────────────────────────────────

describe('smoke', () => {
  it('GRID_COLS is 12', () => {
    assert.equal(GRID_COLS, 12);
  });
});

describe('collides', () => {
  it('overlapping rectangles collide', () => {
    const a = item('a', 0, 0, 2, 2);
    const b = item('b', 1, 1, 2, 2);
    assert.equal(collides(a, b), true);
  });

  it('horizontally adjacent items do not collide', () => {
    const a = item('a', 0, 0, 2, 2);
    const b = item('b', 2, 0, 2, 2);
    assert.equal(collides(a, b), false);
  });

  it('vertically adjacent items do not collide', () => {
    const a = item('a', 0, 0, 2, 2);
    const b = item('b', 0, 2, 2, 2);
    assert.equal(collides(a, b), false);
  });

  it('same id never collides with itself', () => {
    const a = item('a', 0, 0, 4, 4);
    assert.equal(collides(a, a), false);
  });

  it('complete containment collides', () => {
    const outer = item('o', 0, 0, 6, 6);
    const inner = item('i', 2, 2, 2, 2);
    assert.equal(collides(outer, inner), true);
  });

  it('touching at minW boundary only (no overlap)', () => {
    const a = item('a', 0, 0, 2, 2, { minW: 2 });
    const b = item('b', 2, 0, 3, 2, { minW: 3 });
    assert.equal(collides(a, b), false);
  });
});

describe('getCollisions', () => {
  it('returns empty when no overlap', () => {
    const layout = [
      item('a', 0, 0, 2, 2),
      item('b', 4, 0, 2, 2),
    ];
    const probe = item('b', 4, 0, 2, 2);
    assert.deepEqual(getCollisions(layout, probe), []);
  });

  it('returns single colliding item', () => {
    const layout = [
      item('a', 0, 0, 2, 2),
      item('b', 4, 0, 2, 2),
    ];
    const probe = item('x', 1, 1, 2, 2);
    const hits = getCollisions(layout, probe);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].i, 'a');
  });

  it('returns multiple colliding items', () => {
    const dense = [
      item('a', 0, 0, 3, 3),
      item('b', 1, 1, 3, 3),
      item('c', 2, 2, 3, 3),
    ];
    const probe = item('p', 1, 1, 2, 2);
    const hits = getCollisions(dense, probe);
    assert.equal(hits.length, 3);
  });
});

describe('moveElement', () => {
  it('moves to empty cell without collision', () => {
    const layout = [item('a', 0, 0, 2, 2), item('b', 4, 0, 2, 2)];
    const result = moveElement(layout, layout[0], 2, 0);
    const moved = result.find((el) => el.i === 'a');
    assert.deepEqual(moved, { i: 'a', x: 2, y: 0, w: 2, h: 2 });
  });

  it('cascade pushes colliding widget down', () => {
    const layout = [item('a', 0, 0, 4, 2), item('b', 0, 2, 4, 2)];
    const result = moveElement(layout, layout[0], 0, 1);
    const a = result.find((el) => el.i === 'a');
    const b = result.find((el) => el.i === 'b');
    assert.equal(a.y, 1);
    assert.equal(b.y, 3);
  });

  it('clamps x when moving beyond right edge', () => {
    const layout = [item('a', 0, 0, 3, 2)];
    const result = moveElement(layout, layout[0], 11, 0);
    const a = result.find((el) => el.i === 'a');
    assert.equal(a.x, 9);
  });

  it('clamps y to 0 when negative', () => {
    const layout = [item('a', 2, 2, 2, 2)];
    const result = moveElement(layout, layout[0], 2, -1);
    const a = result.find((el) => el.i === 'a');
    assert.equal(a.y, 0);
  });

  it('does not mutate input layout', () => {
    const layout = [item('a', 0, 0, 2, 2)];
    const snapshot = JSON.stringify(layout);
    moveElement(layout, layout[0], 3, 0);
    assert.equal(JSON.stringify(layout), snapshot);
  });
});

describe('resizeElement', () => {
  it('expands width and pushes colliding item', () => {
    const layout = [item('a', 0, 0, 2, 2), item('b', 2, 0, 2, 2)];
    const result = resizeElement(layout, layout[0], 3, 2);
    const a = result.find((el) => el.i === 'a');
    const b = result.find((el) => el.i === 'b');
    assert.equal(a.w, 3);
    assert.equal(b.x, 3);
  });

  it('respects minW and does not shrink below', () => {
    const layout = [item('a', 0, 0, 4, 2, { minW: 3 })];
    const result = resizeElement(layout, layout[0], 2, 2);
    const a = result.find((el) => el.i === 'a');
    assert.equal(a.w, 3);
  });

  it('respects minH on vertical resize', () => {
    const layout = [item('a', 0, 0, 2, 4, { minH: 3 })];
    const result = resizeElement(layout, layout[0], 2, 2);
    const a = result.find((el) => el.i === 'a');
    assert.equal(a.h, 3);
  });

  it('cascade on height growth', () => {
    const layout = [item('a', 0, 0, 4, 2), item('b', 0, 2, 4, 2)];
    const result = resizeElement(layout, layout[0], 4, 3);
    const b = result.find((el) => el.i === 'b');
    assert.equal(b.y, 3);
  });
});

describe('packLayoutFirstFit', () => {
  it('packs default four widgets across 12 columns (not single column)', () => {
    const layout = [
      item('cal-1', 0, 0, 4, 4),
      item('wk-1', 0, 4, 3, 3),
      item('memo-1', 0, 8, 3, 4),
      item('cat-1', 0, 12, 2, 3),
    ];
    const packed = packLayoutFirstFit(layout);
    assert.equal(packed.length, 4);
    const xs = packed.map((p) => p.x);
    assert.ok(xs.some((x) => x > 0), 'at least one widget uses horizontal space');
    for (let i = 0; i < packed.length; i++) {
      for (let j = i + 1; j < packed.length; j++) {
        assert.equal(collides(packed[i], packed[j]), false);
      }
    }
    const maxBottom = Math.max(...packed.map((p) => p.y + p.h));
    assert.ok(maxBottom <= 6, `packed height ${maxBottom} should fit one screen row-group`);
  });
});

describe('compactVertical', () => {
  it('removes vertical gap above item', () => {
    const layout = [item('a', 0, 3, 2, 2), item('b', 3, 0, 2, 2)];
    const result = compactVertical(layout);
    const a = result.find((el) => el.i === 'a');
    assert.equal(a.y, 0);
  });

  it('stacks multiple items without overlap', () => {
    const layout = [
      item('a', 0, 5, 2, 2),
      item('b', 0, 8, 2, 2),
      item('c', 4, 1, 2, 2),
    ];
    const result = compactVertical(layout);
    const a = result.find((el) => el.i === 'a');
    const b = result.find((el) => el.i === 'b');
    assert.equal(a.y, 0);
    assert.equal(b.y, 2);
  });

  it('preserves relative horizontal positions', () => {
    const layout = [item('a', 2, 4, 2, 2), item('b', 6, 4, 2, 2)];
    const result = compactVertical(layout);
    assert.equal(result.find((el) => el.i === 'a').x, 2);
    assert.equal(result.find((el) => el.i === 'b').x, 6);
  });

  it('no-op on already compact layout', () => {
    const layout = [item('a', 0, 0, 2, 2), item('b', 0, 2, 2, 2)];
    const result = compactVertical(layout);
    assert.deepEqual(result, layout);
  });
});

describe('resolveCollisionsCascade', () => {
  it('pushes single collider down by one row', () => {
    const layout = [item('a', 0, 0, 4, 2), item('b', 0, 1, 4, 2)];
    const moved = layout.find((el) => el.i === 'a');
    const result = resolveCollisionsCascade(layout, moved);
    const b = result.find((el) => el.i === 'b');
    assert.equal(b.y, 2);
  });

  it('chain reaction two levels deep', () => {
    const layout = [
      item('a', 0, 0, 4, 2),
      item('b', 0, 2, 4, 2),
      item('c', 0, 4, 4, 2),
    ];
    const moved = { ...layout[0], h: 3 };
    const result = resolveCollisionsCascade(
      layout.map((el) => (el.i === 'a' ? moved : el)),
      moved,
    );
    assert.equal(result.find((el) => el.i === 'b').y, 3);
    assert.equal(result.find((el) => el.i === 'c').y, 5);
  });

  it('stops when no further collisions', () => {
    const layout = [item('a', 0, 0, 2, 2), item('b', 4, 0, 2, 2)];
    const moved = layout[0];
    const result = resolveCollisionsCascade(layout, moved);
    assert.deepEqual(result.find((el) => el.i === 'b'), item('b', 4, 0, 2, 2));
  });
});

describe('pixelToCell', () => {
  it('maps origin pixel to cell 0,0', () => {
    assert.deepEqual(pixelToCell(0, 0, 80, 8), { x: 0, y: 0 });
  });

  it('accounts for gap in stride', () => {
    assert.deepEqual(pixelToCell(88, 176, 80, 8), { x: 1, y: 2 });
  });

  it('handles negative pixel as cell 0', () => {
    assert.deepEqual(pixelToCell(-10, -5, 80, 8), { x: 0, y: 0 });
  });

  it('handles zero cell size without division error', () => {
    assert.deepEqual(pixelToCell(100, 50, 0, 0), { x: 0, y: 0 });
  });
});

describe('clampToBounds', () => {
  it('clamps x when w extends past cols', () => {
    const result = clampToBounds(item('a', 10, 0, 4, 2));
    assert.equal(result.x, 8);
    assert.equal(result.w, 4);
  });

  it('clamps negative y to 0', () => {
    const result = clampToBounds(item('a', 0, -3, 2, 2));
    assert.equal(result.y, 0);
  });

  it('enforces minW when w too small', () => {
    const result = clampToBounds(item('a', 0, 0, 1, 2, { minW: 3 }));
    assert.equal(result.w, 3);
  });

  it('shrinks w to cols when wider than grid', () => {
    const result = clampToBounds(item('a', 0, 0, 20, 2));
    assert.equal(result.x, 0);
    assert.equal(result.w, GRID_COLS);
  });
});
