'use strict';

const { ABILITIES } = require('./catalog');
const { median, sum, unionDurationMs } = require('./stats');

function normalizeName(name) { return String(name || '').trim().toLowerCase(); }

class MonitorEngine {
  constructor(options = {}) {
    this.windowMinutes = options.windowMinutes || 10;
    this.minKills = options.minKills || 6;
    this.xpTarget = options.xpTarget || 0;
    this.killTarget = options.killTarget || 0;
    this.zoneOverride = null;
    this.profile = null;
    this.resetRuntime();
  }

  resetRuntime() {
    this.firstTs = null; this.lastTs = null; this.lastCombatTs = null;
    this.zone = null; this.zoneChangedAt = null; this.level = null; this.levelChangedAt = null; this.levelEpochStart = null;
    this.currentPet = null; this.autoAttack = false; this.invocation = null; this.spellbladeSpell = null;
    this.events = []; this.xp = []; this.kills = []; this.motes = [];
    this.damage = []; this.heals = []; this.attempts = []; this.resists = []; this.casts = []; this.spellFizzles = [];
    this.procBlocked = []; this.progressionChanges = [];
    this.activity = []; this.levelHistory = []; this.alerts = []; this.metricHistory = [];
    this.procBaselines = new Map(); this.procLastSeen = new Map(); this.triggeredEffects = new Map();
    this.primaryEligibleHits = 0;
  }

  setProfile(profile) { this.profile = profile; }

  setSettings(settings = {}) {
    if (Number.isFinite(settings.windowMinutes)) this.windowMinutes = Math.max(2, settings.windowMinutes);
    if (Number.isFinite(settings.minKills)) this.minKills = Math.max(1, Math.floor(settings.minKills));
    if (Number.isFinite(settings.xpTarget)) this.xpTarget = Math.max(0, settings.xpTarget);
    if (Number.isFinite(settings.killTarget)) this.killTarget = Math.max(0, settings.killTarget);
    if ('zoneOverride' in settings) this.zoneOverride = settings.zoneOverride || null;
  }

  ingest(event) {
    if (!event || event.type === 'other') return;
    this.firstTs ??= event.ts; this.lastTs = event.ts; this.events.push(event);
    switch (event.type) {
      case 'level':
        this.level = event.level; this.levelChangedAt = event.ts;
        this.levelEpochStart = event.ts + 1;
        this.levelHistory.push({ ts: event.ts, level: event.level }); this.metricHistory = []; break;
      case 'ability_point':
      case 'ability_unlock':
      case 'spell_memorized':
      case 'spell_forgotten':
        this.progressionChanges.push(event); break;
      case 'invocation':
        this.invocation = event.name;
        this.spellbladeSpell = null;
        this.progressionChanges.push(event);
        break;
      case 'zone': this.zone = event.zone; this.zoneChangedAt = event.ts; break;
      case 'charm_start': this.currentPet = { name: event.pet, startedAt: event.ts }; break;
      case 'charm_end':
        if (this.currentPet && normalizeName(this.currentPet.name) === normalizeName(event.pet)) this.currentPet = null;
        break;
      case 'auto_attack': this.autoAttack = event.enabled; break;
      case 'cast_start': this.casts.push(event); this.markActivity(event.ts, 1000, 2500); break;
      case 'spell_fizzle': this.spellFizzles.push(event); this.markActivity(event.ts, 500, 1500); break;
      case 'mend':
        this.heals.push({ ...event, actor: 'You', target: this.profile?.name || 'You', spell: 'Mend', amount: null, potential: null, owner: 'player', targetSelf: true, sourceType: 'mend' });
        this.markActivity(event.ts, 500, 1000);
        break;
      case 'heal': {
        const tagged = this.tagHeal(event);
        this.heals.push(tagged);
        if (tagged.targetSelf) this.markActivity(event.ts, 500, 1000);
        break;
      }
      case 'proc_blocked': {
        const procs = this.profile?.procs || [];
        const proc = procs.length === 1 ? procs[0] : null;
        this.procBlocked.push({ ...event, proc, confidence: proc ? 'inferred_unique_equipped_proc' : 'unknown' });
        this.markActivity(event.ts, 500, 1000);
        break;
      }
      case 'xp': this.xp.push(event); break;
      case 'kill':
        this.kills.push({ ...event, credit: 'player', confidence: 'confirmed' });
        this.markActivity(event.ts, 5000, 1000); this.captureMetrics(event.ts); break;
      case 'death': {
        const pet = this.currentPet;
        if (pet && normalizeName(event.killer) === normalizeName(pet.name)) {
          const ambiguous = normalizeName(event.target) === normalizeName(pet.name);
          this.kills.push({ ...event, credit: 'pet', confidence: ambiguous ? 'ambiguous' : 'tracked' });
          this.markActivity(event.ts, 5000, 1000); this.captureMetrics(event.ts);
        }
        break;
      }
      case 'mote': this.motes.push(event); break;
      case 'attempt': {
        const tagged = this.tagOwnership(event); this.attempts.push(tagged);
        if (event.actor === 'You') { this.markActivity(event.ts, 1500, 2500); if (this.isPrimaryAttack(tagged)) this.primaryEligibleHits += 1; }
        break;
      }
      case 'resist': this.resists.push(event); this.markActivity(event.ts, 1500, 2500); break;
      case 'damage': {
        const tagged = this.tagOwnership(event); tagged.castClass = this.classifyEffect(tagged); this.damage.push(tagged);
        if (tagged.owner === 'player' || tagged.owner === 'pet') this.markActivity(event.ts, 1500, 2500);
        if (tagged.owner === 'player' && this.isPrimaryAttack(tagged)) this.primaryEligibleHits += 1;
        if (tagged.owner === 'player' && tagged.effect) { this.observeProc(tagged); this.observeTriggeredEffect(tagged); }
        break;
      }
      case 'incoming_damage': this.markActivity(event.ts, 1000, 2000); break;
      default: break;
    }
    this.prune(event.ts);
  }

  tagOwnership(event) {
    if (event.actor === 'You') return { ...event, owner: 'player', confidence: 'confirmed' };
    if (this.currentPet && normalizeName(event.actor) === normalizeName(this.currentPet.name)) {
      const ambiguous = normalizeName(event.actor) === normalizeName(event.target);
      return { ...event, owner: 'pet', confidence: ambiguous ? 'ambiguous' : 'tracked' };
    }
    return { ...event, owner: 'other', confidence: 'unknown' };
  }

  tagHeal(event) {
    const actorName = normalizeName(event.actor);
    const targetName = normalizeName(event.target);
    const playerName = normalizeName(this.profile?.name);
    const owner = event.actor === 'You' ? 'player'
      : (this.currentPet && actorName === normalizeName(this.currentPet.name) ? 'pet' : 'other');
    const targetSelf = targetName === 'you' || (playerName && targetName === playerName);
    let sourceType = owner === 'pet' && targetSelf ? 'pet_heal' : 'other_heal';

    if (owner === 'player' && targetSelf) {
      if (/^Lay on Hands\b/i.test(event.spell)) sourceType = 'cooldown_heal';
      else {
        const recentCast = [...this.casts].reverse().find((cast) => cast.spell === event.spell && event.ts - cast.ts >= 0 && event.ts - cast.ts <= 4000);
        if (recentCast) sourceType = 'manual_cast';
        else if (this.invocation === 'spellblade') {
          if (!this.spellbladeSpell) this.spellbladeSpell = event.spell;
          sourceType = event.spell === this.spellbladeSpell ? 'spellblade_proc' : 'automatic_heal';
        } else sourceType = 'automatic_heal';
      }
    }
    return { ...event, owner, targetSelf, sourceType };
  }

  isPrimaryAttack(event) {
    const primaryType = this.profile?.equipment?.PRIMARY?.damageType;
    return Boolean(primaryType && event.action === primaryType);
  }

  classifyEffect(event) {
    if (!event.effect) return null;
    const known = ABILITIES[event.effect]; if (known) return known.category;
    const recentCast = [...this.casts].reverse().find((cast) => cast.spell === event.effect && event.ts - cast.ts >= 0 && event.ts - cast.ts <= 6000);
    return recentCast ? 'cast_spell' : 'triggered_effect';
  }

  observeTriggeredEffect(event) {
    if (event.castClass !== 'triggered_effect') return;
    const state = this.triggeredEffects.get(event.effect) || { count: 0, firstSeen: event.ts, lastSeen: event.ts };
    state.count += 1; state.lastSeen = event.ts; this.triggeredEffects.set(event.effect, state);
  }

  observeProc(event) {
    const profileProc = this.profile?.procs?.find((p) => p.effectName === event.effect); if (!profileProc) return;
    const key = `${profileProc.slot}:${profileProc.effectName}`;
    const state = this.procBaselines.get(key) || { observed: 0, eligibleAtLast: this.primaryEligibleHits };
    state.observed += 1; state.eligibleAtLast = this.primaryEligibleHits;
    this.procBaselines.set(key, state); this.procLastSeen.set(key, event.ts);
  }

  markActivity(ts, beforeMs, afterMs) {
    this.lastCombatTs = Math.max(this.lastCombatTs || 0, ts); this.activity.push([ts - beforeMs, ts + afterMs]);
  }

  prune(now) {
    const cutoff = now - 60 * 60 * 1000;
    for (const key of ['xp', 'kills', 'motes', 'damage', 'heals', 'attempts', 'resists', 'casts', 'spellFizzles', 'procBlocked', 'activity']) {
      this[key] = this[key].filter((event) => Array.isArray(event) ? event[1] >= cutoff : event.ts >= cutoff);
    }
    this.events = this.events.slice(-5000); this.alerts = this.alerts.slice(-50);
    this.progressionChanges = this.progressionChanges.slice(-100);
  }

  window(now = this.lastTs || Date.now()) {
    const requestedStart = now - this.windowMinutes * 60_000;
    const epochStart = this.levelEpochStart || this.firstTs;
    const start = epochStart == null ? requestedStart : Math.max(requestedStart, epochStart);
    const durationMinutes = Math.max((now - start) / 60_000, 1 / 60);
    const inWindow = (x) => x.ts >= start && x.ts <= now;
    const xp = this.xp.filter(inWindow), kills = this.kills.filter(inWindow), motes = this.motes.filter(inWindow);
    const damage = this.damage.filter(inWindow), heals = this.heals.filter(inWindow), attempts = this.attempts.filter(inWindow), resists = this.resists.filter(inWindow);
    const activityIntervals = this.activity.map(([s, e]) => [Math.max(s, start), Math.min(e, now)]).filter(([s, e]) => e > s);
    const activePct = Math.min(100, unionDurationMs(activityIntervals) / Math.max(1, now - start) * 100);
    const xpSum = sum(xp.map((x) => x.percent));
    const playerDamage = damage.filter((x) => x.owner === 'player');
    const petDamage = damage.filter((x) => x.owner === 'pet' && x.confidence !== 'ambiguous');
    const playerTotal = sum(playerDamage.map((x) => x.amount)), petTotal = sum(petDamage.map((x) => x.amount));
    const receivedHeals = heals.filter((x) => x.targetSelf && Number.isFinite(x.amount));
    const healingReceived = sum(receivedHeals.map((x) => x.amount));
    const selfHealing = sum(receivedHeals.filter((x) => x.owner === 'player').map((x) => x.amount));
    const petHealing = sum(receivedHeals.filter((x) => x.owner === 'pet').map((x) => x.amount));
    const spellbladeHealing = sum(receivedHeals.filter((x) => x.sourceType === 'spellblade_proc').map((x) => x.amount));
    const manualHealing = sum(receivedHeals.filter((x) => x.sourceType === 'manual_cast').map((x) => x.amount));
    const cooldownHealing = sum(receivedHeals.filter((x) => x.sourceType === 'cooldown_heal').map((x) => x.amount));
    const overheal = sum(receivedHeals.map((x) => Math.max(0, (x.potential || x.amount) - x.amount)));
    return {
      start, now, durationMinutes, xpPercent: xpSum, xpPerMinute: xpSum / durationMinutes,
      kills: kills.length, killsPerMinute: kills.length / durationMinutes, xpPerKill: kills.length ? xpSum / kills.length : 0,
      motes: motes.length, motesPerHour: motes.length * 60 / durationMinutes, activePct,
      playerDamage: playerTotal, petDamage: petTotal,
      petShare: (playerTotal + petTotal) ? petTotal / (playerTotal + petTotal) * 100 : 0,
      healingReceived, selfHealing, petHealing, spellbladeHealing, manualHealing, cooldownHealing,
      spellbladeProcs: receivedHeals.filter((x) => x.sourceType === 'spellblade_proc').length,
      mendUses: heals.filter((x) => x.sourceType === 'mend').length,
      overheal, damage, heals, attempts, resists
    };
  }

  recentFarmSample(now = this.lastTs || Date.now()) {
    const epochStart = this.levelEpochStart || this.firstTs;
    const sampleStart = Math.max(epochStart || 0, this.zoneChangedAt || 0);
    const eligibleKills = this.kills.filter((k) => k.ts <= now && k.ts >= sampleStart && k.confidence !== 'ambiguous');
    if (eligibleKills.length < this.minKills) return null;

    const sampleKills = eligibleKills.slice(-this.minKills);
    const first = sampleKills[0];
    const last = sampleKills[sampleKills.length - 1];
    const elapsedMinutes = Math.max((last.ts - first.ts) / 60_000, 1 / 60);
    const killsPerMinute = sampleKills.length > 1 ? (sampleKills.length - 1) / elapsedMinutes : 0;

    let xpTotal = 0;
    let previousBoundary = sampleStart || this.firstTs || first.ts;
    const firstIndex = eligibleKills.length - sampleKills.length;
    if (firstIndex > 0) previousBoundary = eligibleKills[firstIndex - 1].ts;

    for (const kill of sampleKills) {
      xpTotal += sum(this.xp.filter((x) => x.ts > previousBoundary && x.ts <= kill.ts).map((x) => x.percent));
      previousBoundary = kill.ts;
    }

    const xpPerKill = xpTotal / sampleKills.length;
    return {
      ts: last.ts,
      kills: sampleKills.length,
      xpPercent: xpTotal,
      xpPerKill,
      killsPerMinute,
      xpPerMinute: xpPerKill * killsPerMinute,
      firstKillTs: first.ts,
      lastKillTs: last.ts
    };
  }

  farmReference(history) {
    if (history.length < 4) return null;
    const bestBand = [...history].sort((a, b) => b.xpPerMinute - a.xpPerMinute).slice(0, 4);
    return {
      xpPerMinute: median(bestBand.map((x) => x.xpPerMinute)),
      killsPerMinute: median(bestBand.map((x) => x.killsPerMinute)),
      xpPerKill: median(bestBand.map((x) => x.xpPerKill))
    };
  }

  captureMetrics(ts) {
    const sample = this.recentFarmSample(ts);
    if (sample) this.metricHistory.push(sample);
  }

  evaluateStatus(now = this.lastTs || Date.now()) {
    const w = this.window(now);
    if (!this.lastCombatTs || now - this.lastCombatTs > 60_000) return { code: 'IDLE', severity: 'neutral', message: 'Waiting for combat activity.' };
    if (this.levelChangedAt && now - this.levelChangedAt < 90_000) return { code: 'REBASELINING', severity: 'neutral', message: 'Level changed; rebuilding the current baseline.' };

    const recent = this.recentFarmSample(now);
    if (!recent) {
      const sampleStart = Math.max(this.levelEpochStart || this.firstTs || 0, this.zoneChangedAt || 0);
      const currentKills = this.kills.filter((k) => k.ts >= sampleStart && k.ts <= now && k.confidence !== 'ambiguous').length;
      return { code: 'LEARNING', severity: 'neutral', message: `Learning current farm (${currentKills}/${this.minKills} kills).` };
    }

    const history = this.metricHistory.filter((x) => x.ts < recent.ts);
    const ref = this.farmReference(history);
    const xpBelowTarget = this.xpTarget > 0 && recent.xpPerMinute < this.xpTarget;
    const killBelowTarget = this.killTarget > 0 && recent.killsPerMinute < this.killTarget;

    if (!ref) {
      if (killBelowTarget) return { code: 'TOO_HARD', severity: 'warn', message: 'Recent kill throughput is below your manual floor.' };
      if (xpBelowTarget) return { code: 'SOFTENING', severity: 'warn', message: 'Recent XP/min is below your manual floor.' };
      return { code: 'LEARNING', severity: 'neutral', message: 'Learning the productive range for this level.' };
    }

    const xpRatio = ref.xpPerMinute ? recent.xpPerMinute / ref.xpPerMinute : 1;
    const killRatio = ref.killsPerMinute ? recent.killsPerMinute / ref.killsPerMinute : 1;
    const rewardRatio = ref.xpPerKill ? recent.xpPerKill / ref.xpPerKill : 1;

    if (killBelowTarget || (killRatio < 0.65 && xpRatio < 0.90)) {
      return { code: 'TOO_HARD', severity: 'warn', message: `Recent ${recent.kills} kills are much slower than the best productive range for this level. Easier mobs may level faster.` };
    }
    if (rewardRatio < 0.70 && killRatio >= 0.95 && xpRatio < 0.90) {
      return { code: 'MOVE_DEEPER', severity: 'warn', message: `Recent ${recent.kills} kills are fast but worth much less XP than the best productive range for this level. Consider tougher mobs.` };
    }
    if (xpBelowTarget || xpRatio < 0.80) {
      return { code: 'SOFTENING', severity: 'warn', message: `Recent ${recent.kills} kills are producing less XP/min than the best productive range seen at this level.` };
    }
    return { code: 'HEALTHY', severity: 'good', message: `Recent ${recent.kills} kills are performing near the best productive range seen at this level.` };
  }

  damageBreakdown(now = this.lastTs || Date.now()) {
    const w = this.window(now), groups = new Map();
    for (const d of w.damage) {
      if (d.owner !== 'player' && d.owner !== 'pet') continue;
      const label = d.effect || d.action || d.damageType || 'unknown', key = `${d.owner}:${label}`;
      const g = groups.get(key) || { owner: d.owner, label, damage: 0, hits: 0, damageType: d.damageType, category: d.castClass || (d.owner === 'pet' ? 'pet' : 'physical') };
      g.damage += d.amount; g.hits += 1; groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.damage - a.damage).slice(0, 20);
  }

  healingBreakdown(now = this.lastTs || Date.now()) {
    const w = this.window(now), groups = new Map();
    for (const h of w.heals) {
      if (!h.targetSelf) continue;
      const label = h.spell || h.sourceType || 'healing', key = `${h.sourceType}:${label}`;
      const g = groups.get(key) || { sourceType: h.sourceType, label, uses: 0, healing: 0, potential: 0 };
      g.uses += 1;
      if (Number.isFinite(h.amount)) g.healing += h.amount;
      if (Number.isFinite(h.potential)) g.potential += h.potential;
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.healing - a.healing);
  }

  procAlerts(now = this.lastTs || Date.now()) {
    const alerts = [];
    const blockedKeys = new Set();
    const start = now - this.windowMinutes * 60_000;
    const recentBlocked = this.procBlocked.filter((x) => x.ts >= start && x.ts <= now);
    if (recentBlocked.length) {
      const inferred = recentBlocked.filter((x) => x.proc);
      if (inferred.length) {
        const proc = inferred[inferred.length - 1].proc;
        const key = `${proc.slot}:${proc.effectName}`; blockedKeys.add(key);
        alerts.push({ code: 'PROC_BLOCKED', severity: 'warn', message: `${proc.itemName || proc.slot}: ${proc.effectName} attempted ${inferred.length} time${inferred.length === 1 ? '' : 's'} but the game reports your will is not sufficient to command the weapon.` });
      } else {
        alerts.push({ code: 'PROC_BLOCKED', severity: 'warn', message: `A weapon proc was blocked ${recentBlocked.length} time${recentBlocked.length === 1 ? '' : 's'} by a weapon level/will requirement.` });
      }
    }
    for (const [effect, state] of this.triggeredEffects.entries()) {
      if (state.count >= 3 && now - state.lastSeen <= this.windowMinutes * 60_000) alerts.push({ code: 'TRIGGERED_EFFECT', severity: 'info', message: `Unmapped automatic effect observed: ${effect} (${state.count} times).` });
    }
    for (const proc of this.profile?.procs || []) {
      const key = `${proc.slot}:${proc.effectName}`;
      if (blockedKeys.has(key)) continue;
      const baseline = this.procBaselines.get(key);
      if (!baseline || baseline.observed < 3 || this.primaryEligibleHits < 20) continue;
      const historicalRate = baseline.observed / Math.max(1, baseline.eligibleAtLast);
      const since = this.primaryEligibleHits - baseline.eligibleAtLast, expected = since * historicalRate;
      if (expected >= 3.5) alerts.push({ code: 'PROC_MISSING', severity: 'warn', message: `${proc.itemName || proc.slot}: ${proc.effectName} has not appeared in ${since} qualifying primary hits (~${expected.toFixed(1)} expected).` });
    }
    return alerts;
  }

  mobMix(now = this.lastTs || Date.now()) {
    const w = this.window(now), counts = new Map();
    for (const k of this.kills) { if (k.ts < w.start || k.ts > now) continue; counts.set(k.target, (counts.get(k.target) || 0) + 1); }
    return [...counts.entries()].map(([name, kills]) => ({ name, kills })).sort((a, b) => b.kills - a.kills).slice(0, 6);
  }

  snapshot(now = this.lastTs || Date.now()) {
    const w = this.window(now), status = this.evaluateStatus(now), zone = this.zoneOverride || this.zone || 'Unknown';
    return {
      character: this.profile ? { name: this.profile.name, race: this.profile.race, classes: this.profile.classes, primary: this.profile.equipment?.PRIMARY || null, secondary: this.profile.equipment?.SECONDARY || null, procs: this.profile.procs || [] } : null,
      level: this.level, zone, pet: this.currentPet?.name || null, invocation: this.invocation, spellbladeSpell: this.spellbladeSpell, metrics: w, status,
      procAlerts: this.procAlerts(now), damageBreakdown: this.damageBreakdown(now), healingBreakdown: this.healingBreakdown(now), mobMix: this.mobMix(now),
      recentLevels: this.levelHistory.slice(-8), recentChanges: this.progressionChanges.slice(-12),
      spellFizzles: this.spellFizzles.filter((x) => x.ts >= w.start && x.ts <= now)
    };
  }
}

module.exports = { MonitorEngine, normalizeName };
