'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MonitorEngine } = require('../src/core/engine');
const { parseLine } = require('../src/core/parser');

const prefix = '[Tue Sep 01 20:00:00 2026] ';

test('surfaces Finishing Blow and landed Flurry in damage breakdown', () => {
  const e = new MonitorEngine({ windowMinutes: 10, minKills: 1 });
  e.ingest(parseLine(prefix + 'You pierce Terror for 723 points of damage. (Finishing Blow)'));
  e.ingest(parseLine(prefix + 'You pierce Cazic-Thule for 32 points of damage. (Flurry)'));
  const missedFlurry = parseLine(prefix + 'You try to pierce Cazic-Thule, but miss! (Flurry)');
  e.ingest(missedFlurry);

  assert.equal(missedFlurry.modifier, 'Flurry');
  const breakdown = e.damageBreakdown();
  const finishing = breakdown.find((entry) => entry.label === 'Finishing Blow');
  const flurry = breakdown.find((entry) => entry.label === 'Flurry');

  assert.ok(finishing);
  assert.equal(finishing.damage, 723);
  assert.equal(finishing.category, 'combat_special');
  assert.ok(flurry);
  assert.equal(flurry.damage, 32);
  assert.equal(flurry.category, 'combat_special');
});

test('recognizes combined combat modifiers', () => {
  const criticalFlurry = parseLine(prefix + 'You pierce Coercer T`vala for 99 points of damage. (Critical Flurry)');
  const finishingRiposte = parseLine(prefix + 'You slash an elite dragoon for 51 points of damage. (Riposte Strikethrough Finishing Blow)');

  assert.equal(criticalFlurry.effect, 'Flurry');
  assert.equal(criticalFlurry.action, 'pierce');
  assert.equal(finishingRiposte.effect, 'Finishing Blow');
  assert.equal(finishingRiposte.action, 'slash');
});
