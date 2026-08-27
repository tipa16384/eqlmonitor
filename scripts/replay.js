'use strict';

const fs = require('node:fs');
const readline = require('node:readline');
const { parseLine } = require('../src/core/parser');
const { MonitorEngine } = require('../src/core/engine');
const { loadProfile } = require('../src/core/profile');

function parseArgs(argv) {
  const out = { windowMinutes: 10, zone: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--log') out.log = argv[++i];
    else if (arg === '--profile') out.profile = argv[++i];
    else if (arg === '--zone') out.zone = argv[++i];
    else if (arg === '--window') out.windowMinutes = Number(argv[++i]);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.log) {
    console.error('Usage: npm run replay -- --log /path/eqlog.txt [--profile character.json] [--zone Befallen]');
    process.exit(2);
  }
  const engine = new MonitorEngine({ windowMinutes: args.windowMinutes });
  if (args.profile) engine.setProfile(loadProfile(args.profile));
  if (args.zone) engine.setSettings({ zoneOverride: args.zone });
  const rl = readline.createInterface({ input: fs.createReadStream(args.log), crlfDelay: Infinity });
  let firstLevel = null;
  for await (const line of rl) {
    const event = parseLine(line);
    if (event?.type === 'level' && firstLevel == null) firstLevel = event.level;
    engine.ingest(event);
  }
  const snap = engine.snapshot();
  const totalXp = engine.xp.reduce((a, x) => a + x.percent, 0);
  console.log(JSON.stringify({
    character: snap.character?.name || null,
    build: snap.character?.classes || [],
    startingLevelInferred: firstLevel == null ? null : firstLevel - 1,
    endingLevel: snap.level,
    zone: snap.zone,
    totalXpPercent: Number(totalXp.toFixed(3)),
    kills: engine.kills.length,
    motes: engine.motes.length,
    trackedPetKills: engine.kills.filter((k) => k.credit === 'pet').length,
    lastWindow: {
      minutes: Number(snap.metrics.durationMinutes.toFixed(2)),
      xpPerMinute: Number(snap.metrics.xpPerMinute.toFixed(3)),
      killsPerMinute: Number(snap.metrics.killsPerMinute.toFixed(3)),
      motesPerHour: Number(snap.metrics.motesPerHour.toFixed(2)),
      petSharePercent: Number(snap.metrics.petShare.toFixed(1))
    },
    status: snap.status,
    topDamage: snap.damageBreakdown.slice(0, 10)
  }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
