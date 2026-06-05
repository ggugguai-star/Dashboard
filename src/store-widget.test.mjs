/**
 * store-widget 골든셋 — 위젯 CRUD 헬퍼
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyState,
  seedDefaultWidgets,
  generateWidgetId,
  createWidget,
  addWidget,
  removeWidget,
  updateWidgetSource,
} from './store.js';

describe('generateWidgetId', () => {
  it('picks next free id', () => {
    const widgets = [{ id: 'cal-1' }, { id: 'cal-2' }];
    assert.equal(generateWidgetId('calendar', widgets), 'cal-3');
  });
});

describe('addWidget', () => {
  it('appends calendar with compact coords', () => {
    const base = seedDefaultWidgets(createEmptyState());
    const next = addWidget(base, 'calendar');
    const cals = next.widgets.filter((w) => w.type === 'calendar');
    assert.equal(cals.length, 2);
    assert.equal(cals[1].id, 'cal-2');
    assert.equal(cals[1].source.calendarId, 'primary');
    assert.ok(typeof cals[1].x === 'number');
    assert.ok(typeof cals[1].y === 'number');
  });
});

describe('removeWidget', () => {
  it('removes and repacks', () => {
    const base = seedDefaultWidgets(createEmptyState());
    const added = addWidget(base, 'calendar');
    const next = removeWidget(added, 'cal-2');
    assert.equal(next.widgets.filter((w) => w.id === 'cal-2').length, 0);
    assert.equal(next.widgets.length, 4);
  });
});

describe('updateWidgetSource', () => {
  it('patches title and source', () => {
    const base = seedDefaultWidgets(createEmptyState());
    const next = updateWidgetSource(base, 'cal-1', {
      title: '업무',
      source: { calendarId: 'work@group.calendar.google.com' },
    });
    const cal = next.widgets.find((w) => w.id === 'cal-1');
    assert.equal(cal.title, '업무');
    assert.equal(cal.source.calendarId, 'work@group.calendar.google.com');
  });
});

describe('createWidget', () => {
  it('creates category with cat-N id', () => {
    const base = seedDefaultWidgets(createEmptyState());
    const w = createWidget('category', base.widgets);
    assert.match(w.id, /^cat-\d+$/);
    assert.ok(w.color);
    assert.deepEqual(w.items, []);
  });
});
