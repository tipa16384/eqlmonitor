'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLine } = require('../src/core/parser');
const { MonitorEngine } = require('../src/core/engine');

const line = (time, text) => parseLine(`[Sat Sep 05 ${time} 2026] ${text}`);

test('parses bonus XP used by current EQL logs', () => {
  const xp = line('09:53:33', 'You gain experience (with a bonus)! (2.589%)');
  assert.equal(xp.type, 'xp');
  assert.equal(xp.percent, 2.589);
});

test('parses Monk skill-ups and labels their generic combat verbs', () => {
  const e = new MonitorEngine({ windowMinutes: 10, minKills: 1 });
  e.ingest(line('09:57:58', 'You have become better at Tiger Claw! (156)'));
  e.ingest(line('09:57:58', 'You strike a greater ice bones for 25 points of damage.'));
  e.ingest(line('09:58:05', 'You have become better at Round Kick! (156)'));
  e.ingest(line('09:58:05', 'You kick a greater ice bones for 28 points of damage.'));

  const breakdown = e.damageBreakdown();
  assert.equal(breakdown.find((x) => x.label === 'Tiger Claw').damage, 25);
  assert.equal(breakdown.find((x) => x.label === 'Round Kick').damage, 28);
});

test('mote rate keeps its rolling window across a level ding', () => {
  const e = new MonitorEngine({ windowMinutes: 10, minKills: 1 });
  e.ingest(line('10:00:00', 'You have entered The Ruins of Old Guk.'));
  e.ingest(line('10:04:00', "You looted a Mote of Infinitesimal Potential from a ghoul supplier's corpse and stored it in your currency"));
  e.ingest(line('10:05:00', 'You have gained a level! Welcome to level 32!'));
  e.ingest(line('10:08:00', 'You pierce a ghoul supplier for 40 points of damage.'));

  const metrics = e.window(Date.parse('2026-09-05T10:08:00'));
  assert.equal(metrics.motes, 1);
  assert.ok(metrics.motesPerHour > 0);
});

test('maps Suffocate as a DoT spell', () => {
  const e = new MonitorEngine({ windowMinutes: 10, minKills: 1 });
  e.ingest(line('10:37:42', 'You begin casting Suffocate.'));
  e.ingest(line('10:37:45', 'You hit a zol ghoul knight for 87 points of magic damage by Suffocate.'));
  e.ingest(line('10:37:48', 'A zol ghoul knight has taken 43 damage from your Suffocate.'));

  const suffocate = e.damageBreakdown().find((x) => x.label === 'Suffocate');
  assert.ok(suffocate);
  assert.equal(suffocate.damage, 130);
  assert.equal(suffocate.category, 'dot_spell');
});

test('separates manual Anarchy from SpellBlade-triggered Anarchy', () => {
  const e = new MonitorEngine({ windowMinutes: 10, minKills: 1 });
  e.ingest(line('11:27:28', 'You begin reciting the spellblade invocation.'));
  e.ingest(line('11:33:55', 'You begin casting Anarchy.'));
  e.ingest(line('11:33:58', 'You hit a basalt gargoyle for 281 points of magic damage by Anarchy.'));
  e.ingest(line('11:34:01', 'You hit a basalt gargoyle for 281 points of magic damage by Anarchy.'));

  const breakdown = e.damageBreakdown();
  const manual = breakdown.find((x) => x.label === 'Anarchy (cast)');
  const spellblade = breakdown.find((x) => x.label === 'Anarchy (SpellBlade)');
  assert.ok(manual);
  assert.ok(spellblade);
  assert.equal(manual.damage, 281);
  assert.equal(spellblade.damage, 281);
});
