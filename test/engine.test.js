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
