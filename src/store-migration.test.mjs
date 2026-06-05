/**
 * store-migration 골든셋 — localStorage 스냅샷 → 통합 JSON 정답표
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collides } from './layout-engine.js';
import {
  SCHEMA_VERSION,
  buildStateFromLocalStorage,
  seedDefaultWidgets,
  autoPackWidgets,
  createEmptyState,
  applyMigrationIdempotent,
} from './store.js';

const FIXED_AT = '2026-06-05T12:00:00.000Z';
const opts = { migratedAt: FIXED_AT };

function layoutFromWidgets(widgets) {
  return widgets.map((w) => ({
    i: w.id,
    x: w.x,
    y: w.y,
    w: w.w,
    h: w.h,
  }));
}

function assertNoOverlaps(widgets) {
  const layout = layoutFromWidgets(widgets);
  for (let i = 0; i < layout.length; i++) {
    for (let j = i + 1; j < layout.length; j++) {
      assert.equal(
        collides(layout[i], layout[j]),
        false,
        `overlap ${layout[i].i} vs ${layout[j].i}`,
      );
    }
  }
}

describe('buildStateFromLocalStorage', () => {
  it('M1: empty snapshot → schema 3 + 4 default widgets + auto-pack', () => {
    const state = buildStateFromLocalStorage({}, opts);
    assert.equal(state.schema, SCHEMA_VERSION);
    assert.equal(state.grid.cols, 12);
    assert.equal(state.widgets.length, 4);
    assert.deepEqual(
      state.widgets.map((w) => w.id).sort(),
      ['cal-1', 'cat-1', 'memo-1', 'wk-1'],
    );
    for (const w of state.widgets) {
      assert.equal(typeof w.x, 'number');
      assert.equal(typeof w.y, 'number');
      assert.equal(typeof w.w, 'number');
      assert.equal(typeof w.h, 'number');
    }
    assert.equal(state._migrated, true);
    assert.equal(state._migratedAt, FIXED_AT);
    assertNoOverlaps(state.widgets);
  });

  it('M2: appCats+appTodos+appScale+setupDone migrate fully', () => {
    const snapshot = {
      appCats: JSON.stringify([
        { color: '#ff0000', icon: '📚', name: '공부', items: [{ label: 'a', path: '/a' }] },
      ]),
      appTodos: JSON.stringify([{ id: 't1', text: '할일', done: false }]),
      appScale: '120',
      setupDone: '1',
    };
    const state = buildStateFromLocalStorage(snapshot, opts);
    assert.equal(state.settings.scale, 120);
    assert.equal(state.settings.setupDone, true);

    const todo = state.widgets.find((w) => w.id === 'memo-1');
    assert.equal(todo.items.length, 1);
    assert.equal(todo.items[0].text, '할일');

    const cat = state.widgets.find((w) => w.id === 'cat-1');
    assert.equal(cat.title, '공부');
    assert.equal(cat.color, '#ff0000');
    assert.equal(cat.items.length, 1);
  });

  it('M3: driveWeeklyId+weeklyPlanTitle → drive widget title·folderId', () => {
    const snapshot = {
      driveWeeklyId: 'folder-abc',
      weeklyPlanTitle: '3월 주간',
    };
    const state = buildStateFromLocalStorage(snapshot, opts);
    const drive = state.widgets.find((w) => w.id === 'wk-1');
    assert.equal(drive.title, '3월 주간');
    assert.equal(drive.source.folderId, 'folder-abc');
  });

  it('M4: gtasksListId+gtasksLastSync → todo source·settings', () => {
    const snapshot = {
      gtasksListId: 'list-xyz',
      gtasksLastSync: '1710000000000',
    };
    const state = buildStateFromLocalStorage(snapshot, opts);
    const todo = state.widgets.find((w) => w.id === 'memo-1');
    assert.equal(todo.source.taskListId, 'list-xyz');
    assert.equal(state.settings.gtasksLastSync, 1710000000000);
  });

  it('M5: calAlarms preserved in settings', () => {
    const alarms = { ev1: { fired: true } };
    const snapshot = {
      calAlarms: JSON.stringify(alarms),
    };
    const state = buildStateFromLocalStorage(snapshot, opts);
    assert.deepEqual(state.settings.calAlarms, alarms);
  });

  it('M6: same snapshot twice → deepEqual (idempotent build)', () => {
    const snapshot = {
      appScale: '90',
      driveMemoId: 'memo-folder',
      weeklyPlanTitle: 'Weekly',
    };
    const a = buildStateFromLocalStorage(snapshot, opts);
    const b = buildStateFromLocalStorage(snapshot, opts);
    assert.deepEqual(a, b);
  });

  it('M8: broken JSON field → fallback without throw', () => {
    const snapshot = {
      appCats: '{not valid json',
      appTodos: '[]',
    };
    const state = buildStateFromLocalStorage(snapshot, opts);
    assert.equal(Array.isArray(state.widgets), true);
    const cats = state.widgets.filter((w) => w.type === 'category');
    assert.equal(cats.length, 0);
    const todo = state.widgets.find((w) => w.id === 'memo-1');
    assert.deepEqual(todo.items, []);
  });
});

describe('autoPackWidgets', () => {
  it('M7: auto-pack produces zero widget overlaps', () => {
    const widgets = seedDefaultWidgets(createEmptyState()).widgets;
    assert.equal(widgets.length, 4);
    assertNoOverlaps(widgets);
  });
});

describe('applyMigrationIdempotent', () => {
  it('returns clone when already migrated (no re-transform)', () => {
    const state = buildStateFromLocalStorage({}, opts);
    const again = applyMigrationIdempotent(state);
    assert.deepEqual(again, state);
    assert.notEqual(again, state);
    assert.equal(again._migrated, true);
  });
});

describe('seedDefaultWidgets', () => {
  it('does not replace existing widgets', () => {
    const base = createEmptyState();
    base.widgets = [{ id: 'custom-1', type: 'calendar', x: 0, y: 0, w: 4, h: 4 }];
    const out = seedDefaultWidgets(base);
    assert.equal(out.widgets.length, 1);
    assert.equal(out.widgets[0].id, 'custom-1');
  });
});
