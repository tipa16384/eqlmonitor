# EQL Monitor

A local-first live leveling/farming monitor for **EverQuest Legends**. It tails the EQ log and answers the practical question: **is the current farm still working, or is it time to move to tougher/easier mobs?**

This is intentionally not a traditional DPS parser. The top-level metrics are XP/minute, kills/minute, mote yield, and trend. Combat detail is used to explain changes and detect anomalies such as a weapon proc disappearing.

## Current MVP

- Imports an EQ Legends Tools character-sheet JSON export.
- Tails a selected EQ log from disk and keeps reading appended lines.
- Tracks level changes, zoning, XP awards, player/pet kills, mote drops, charm state, damage, avoids/resists, and cast starts.
- Shows rolling XP/min, kills/min, motes/hour, active-farming %, pet contribution, and damage breakdown.
- Produces conservative states: `IDLE`, `LEARNING`, `REBASELINING`, `HEALTHY`, `SOFTENING`, `MOVE_DEEPER`, `TOO_HARD`.
- Contains initial item metadata for Ghoulbane and Serpent's Tooth.
- Provides a replay CLI and Node test suite; the core has no Electron dependency.

## Run

Requires Node 22+.

```bash
npm install
npm test
npm start
```

Use **Load Character Profile** to select a character-sheet JSON export, then **Open EQ Log** to select `eqlog_*.txt`. The first load replays the file from the beginning to build context, then continues tailing new lines.

## Replay a historical log

The replay tool is useful while developing parser rules without launching Electron:

```bash
npm run replay -- \
  --profile "/path/to/character-sheet.json" \
  --log "/path/to/eqlog.txt" \
  --zone Befallen
```

`--zone` is useful when the log begins after the character has already entered a zone and therefore contains no initial zoning message.

## Design notes

### Farm status

The monitor uses a rolling window (default 10 minutes) and a level-local recent reference. It intentionally prefers inertia: a farm stays `HEALTHY` unless there is enough evidence that it has degraded.

- **MOVE_DEEPER**: XP/min has fallen mainly because XP/kill is falling while kill throughput is still healthy. This is the classic "outgrowing the mobs" signal.
- **TOO_HARD**: kill throughput has fallen enough that the extra reward is not compensating.
- **SOFTENING**: XP/min is down, but the cause is not yet strong enough for a more specific recommendation.
- **REBASELINING**: after a level change, the monitor temporarily avoids comparing the new level directly with the old one.

These heuristics are deliberately simple and inspectable. They are expected to evolve with live testing.

### Proc anomalies

The character profile identifies equipment procs. The engine can learn an observed proc rate and later warn when the proc is absent for enough qualifying attacks. A verified mapping between the character-sheet effect name and the exact combat-log manifestation may be required for some items.

### Charm ownership

Charm success/wear-off messages maintain a pet state. Damage from the active pet name is credited to the player. Same-name pet/target situations are marked ambiguous rather than silently treated as exact.

## Project layout

- `electron/` — desktop shell, file dialogs, log tailing, notifications.
- `src/core/` — parser, state engine, profile normalization, catalogs. No Electron dependency.
- `src/renderer/` — small live dashboard.
- `scripts/replay.js` — historical-log replay/debug tool.
- `test/` — Node built-in tests.

## Privacy

Logs and character files are read locally. The app has no server component and does not upload them.
