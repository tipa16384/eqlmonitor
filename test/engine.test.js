'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MonitorEngine } = require('../src/core/engine');
const { parseLine } = require('../src/core/parser');
const line = (time, text) => parseLine(`[Wed Aug 26 20:${time} 2026] ${text}`);

test('tracks charmed pet damage and kills', () => {
  const e = new MonitorEngine({ windowMinutes: 10, minKills: 1 });
  e.ingest(line('21:00', 'a skeletal excavator has been charmed.'));
  e.ingest(line('21:05', 'A skeletal excavator slashes a necro initiate for 44 points of damage.'));
  e.ingest(line('21:06', 'A necro initiate has been slain by a skeletal excavator!'));
  const snap = e.snapshot();
  assert.equal(snap.metrics.petDamage, 44); assert.equal(snap.metrics.kills, 1);
});

test('flags a degrading XP rate', () => {
  const e = new MonitorEngine({ windowMinutes: 2, minKills: 2 });
  const now = Date.parse('2026-08-26T20:10:00');
  e.firstTs = now - 600000; e.lastCombatTs = now;
  e.metricHistory = [
    { ts: now - 300000, xpPerMinute: 6, killsPerMinute: 2, xpPerKill: 3 },
    { ts: now - 240000, xpPerMinute: 6.2, killsPerMinute: 2.1, xpPerKill: 3 },
    { ts: now - 180000, xpPerMinute: 5.9, killsPerMinute: 2, xpPerKill: 2.95 },
    { ts: now - 120000, xpPerMinute: 6.1, killsPerMinute: 2, xpPerKill: 3.05 },
    { ts: now - 60000, xpPerMinute: 6, killsPerMinute: 2, xpPerKill: 3 }
  ];
  e.kills = [{ ts: now - 50000 }, { ts: now - 20000 }, { ts: now - 5000 }];
  e.xp = [{ ts: now - 50000, percent: 1 }, { ts: now - 20000, percent: 1 }, { ts: now - 5000, percent: 1 }];
  e.activity = [[now - 120000, now]];
  assert.ok(['MOVE_DEEPER', 'SOFTENING'].includes(e.evaluateStatus(now).code));
});

test('recognizes Condemnation of Nife as a Paladin innate proc', () => {
  const e = new MonitorEngine({ windowMinutes: 10, minKills: 1 });
  e.ingest(line('21:00', 'You hit a ghoul for 42 points of magic damage by Condemnation of Nife.'));
  const snap = e.snapshot();
  const effect = snap.damageBreakdown.find((entry) => entry.label === 'Condemnation of Nife');
  assert.ok(effect);
  assert.equal(effect.category, 'innate_proc');
  assert.equal(snap.procAlerts.some((alert) => /Condemnation of Nife/.test(alert.message)), false);
});

test('attributes a blocked weapon proc when the profile has one equipped proc', () => {
  const e = new MonitorEngine({ windowMinutes: 10, minKills: 1 });
  e.setProfile({ procs: [{ slot: 'PRIMARY', effectName: 'Dismiss Undead', itemName: 'Ghoulbane' }] });
  e.ingest(line('21:00', 'Your will is not sufficient to command this weapon.'));
  const alert = e.snapshot().procAlerts.find((entry) => entry.code === 'PROC_BLOCKED');
  assert.ok(alert);
  assert.match(alert.message, /Ghoulbane/);
  assert.match(alert.message, /Dismiss Undead/);
});

test('does not count the ding kill reward in the new level baseline', () => {
  const e = new MonitorEngine({ windowMinutes: 10, minKills: 1 });
  e.ingest(line('21:00', 'You have gained a level! Welcome to level 17!'));
  e.ingest(line('21:00', 'You gain experience! (3.061%)'));
  e.ingest(line('21:00', 'You have slain a willowisp!'));
  e.ingest(line('21:02', 'You gain experience! (4.000%)'));
  e.ingest(line('21:02', 'You have slain a ghoul!'));
  const snap = e.snapshot();
  assert.equal(snap.metrics.kills, 1);
  assert.equal(snap.metrics.xpPercent, 4);
});

test('separates SpellBlade proc healing from manual and pet healing', () => {
  const e = new MonitorEngine({ windowMinutes: 10, minKills: 1 });
  e.setProfile({ name: 'Tipa' });
  e.ingest(line('21:00', 'a Teir`Dal ranger has been charmed.'));
  e.ingest(line('21:01', 'You begin reciting the spellblade invocation.'));
  e.ingest(line('21:02', 'You healed Tipa for 67 hit points by Light Healing.'));
  e.ingest(line('21:03', 'a Teir`Dal ranger healed you for 66 hit points by Light Healing.'));
  e.ingest(line('21:04', 'You begin casting Light Healing.'));
  e.ingest(line('21:05', 'You healed Tipa for 40 (67) hit points by Light Healing.'));
  e.ingest(line('21:06', 'You mend your wounds and heal some damage.'));
  const snap = e.snapshot();
  assert.equal(snap.invocation, 'spellblade');
  assert.equal(snap.spellbladeSpell, 'Light Healing');
  assert.equal(snap.metrics.spellbladeProcs, 1);
  assert.equal(snap.metrics.spellbladeHealing, 67);
  assert.equal(snap.metrics.petHealing, 66);
  assert.equal(snap.metrics.manualHealing, 40);
  assert.equal(snap.metrics.overheal, 27);
  assert.equal(snap.metrics.mendUses, 1);
});

function addFarmKill(engine, state, seconds, xpPercent, target = 'mob') {
  state.ts += seconds * 1000;
  engine.ingest({ type: 'xp', ts: state.ts - 1, percent: xpPercent });
  engine.ingest({ type: 'kill', ts: state.ts, target });
}

test('Auto distinguishes productive, too-easy, and too-hard recent kills', () => {
  const e = new MonitorEngine({ windowMinutes: 10, minKills: 4 });
  const state = { ts: Date.parse('2026-08-29T12:00:00-04:00') };
  e.ingest({ type: 'level', ts: state.ts, level: 21 });
  state.ts += 91_000;

  for (let i = 0; i < 12; i += 1) addFarmKill(e, state, 30, 3, 'productive mob');
  assert.equal(e.evaluateStatus(state.ts).code, 'HEALTHY');

  for (let i = 0; i < 4; i += 1) addFarmKill(e, state, 10, 0.3, 'too easy mob');
  assert.equal(e.evaluateStatus(state.ts).code, 'MOVE_DEEPER');

  for (let i = 0; i < 4; i += 1) addFarmKill(e, state, 120, 8, 'too hard mob');
  assert.equal(e.evaluateStatus(state.ts).code, 'TOO_HARD');
});

test('Auto best-level reference does not drift downward during a poor camp', () => {
  const e = new MonitorEngine({ windowMinutes: 10, minKills: 4 });
  const state = { ts: Date.parse('2026-08-29T12:00:00-04:00') };
  e.ingest({ type: 'level', ts: state.ts, level: 21 });
  state.ts += 91_000;

  for (let i = 0; i < 12; i += 1) addFarmKill(e, state, 30, 3, 'productive mob');
  const before = e.farmReference(e.metricHistory.slice(0, -1));
  for (let i = 0; i < 24; i += 1) addFarmKill(e, state, 10, 0.2, 'poor mob');
  const after = e.farmReference(e.metricHistory.slice(0, -1));
  assert.ok(after.xpPerMinute >= before.xpPerMinute);
});

test('Auto starts a fresh recent sample after zoning but keeps the level reference', () => {
  const e = new MonitorEngine({ windowMinutes: 10, minKills: 4 });
  const state = { ts: Date.parse('2026-08-29T12:00:00-04:00') };
  e.ingest({ type: 'level', ts: state.ts, level: 21 });
  state.ts += 91_000;
  e.ingest({ type: 'zone', ts: state.ts, zone: 'Camp A' });

  for (let i = 0; i < 12; i += 1) addFarmKill(e, state, 30, 3, 'productive mob');
  assert.ok(e.farmReference(e.metricHistory.slice(0, -1)));

  state.ts += 1_000;
  e.ingest({ type: 'zone', ts: state.ts, zone: 'Camp B' });
  for (let i = 0; i < 3; i += 1) addFarmKill(e, state, 20, 3, 'new camp mob');
  assert.equal(e.evaluateStatus(state.ts).code, 'LEARNING');
  addFarmKill(e, state, 20, 3, 'new camp mob');
  assert.notEqual(e.evaluateStatus(state.ts).code, 'LEARNING');
});
