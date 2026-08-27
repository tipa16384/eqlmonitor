'use strict';

const { ABILITIES } = require('./catalog');
const { median, percentile, sum, unionDurationMs } = require('./stats');

function normalizeName(name) { return String(name || '').trim().toLowerCase(); }

class MonitorEngine {
  constructor(options = {}) {
    this.windowMinutes = options.windowMinutes || 10;
    this.minKills = options.minKills || 4;
    this.xpTarget = options.xpTarget || 0;
    this.killTarget = options.killTarget || 0;
    this.zoneOverride = null;
    this.profile = null;
    this.resetRuntime();
  }

  resetRuntime() {
    this.firstTs = null; this.lastTs = null; this.lastCombatTs = null;
    this.zone = null; this.level = null; this.levelChangedAt = null;
    this.currentPet = null; this.autoAttack = false;
    this.events = []; this.xp = []; this.kills = []; this.motes = [];
    this.damage = []; this.attempts = []; this.resists = []; this.casts = [];
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
        this.levelHistory.push({ ts: event.ts, level: event.level }); this.metricHistory = []; break;
      case 'zone': this.zone = event.zone; break;
      case 'charm_start': this.currentPet = { name: event.pet, startedAt: event.ts }; break;
      case 'charm_end':
        if (this.currentPet && normalizeName(this.currentPet.name) === normalizeName(event.pet)) this.currentPet = null;
        break;
      case 'auto_attack': this.autoAttack = event.enabled; break;
      case 'cast_start': this.casts.push(event); this.markActivity(event.ts, 1000, 2500); break;
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
    for (const key of ['xp', 'kills', 'motes', 'damage', 'attempts', 'resists', 'casts', 'activity']) {
      this[key] = this[key].filter((event) => Array.isArray(event) ? event[1] >= cutoff : event.ts >= cutoff);
    }
    this.events = this.events.slice(-5000); this.alerts = this.alerts.slice(-50);
    this.metricHistory = this.metricHistory.filter((x) => x.ts >= cutoff);
  }

  window(now = this.lastTs || Date.now()) {
    const requestedStart = now - this.windowMinutes * 60_000;
    const epochStart = this.levelChangedAt || this.firstTs;
    const start = epochStart == null ? requestedStart : Math.max(requestedStart, epochStart);
    const durationMinutes = Math.max((now - start) / 60_000, 1 / 60);
    const inWindow = (x) => x.ts >= start && x.ts <= now;
    const xp = this.xp.filter(inWindow), kills = this.kills.filter(inWindow), motes = this.motes.filter(inWindow);
    const damage = this.damage.filter(inWindow), attempts = this.attempts.filter(inWindow), resists = this.resists.filter(inWindow);
    const activityIntervals = this.activity.map(([s, e]) => [Math.max(s, start), Math.min(e, now)]).filter(([s, e]) => e > s);
    const activePct = Math.min(100, unionDurationMs(activityIntervals) / Math.max(1, now - start) * 100);
    const xpSum = sum(xp.map((x) => x.percent));
    const playerDamage = damage.filter((x) => x.owner === 'player');
    const petDamage = damage.filter((x) => x.owner === 'pet' && x.confidence !== 'ambiguous');
    const playerTotal = sum(playerDamage.map((x) => x.amount)), petTotal = sum(petDamage.map((x) => x.amount));
    return {
      start, now, durationMinutes, xpPercent: xpSum, xpPerMinute: xpSum / durationMinutes,
      kills: kills.length, killsPerMinute: kills.length / durationMinutes, xpPerKill: kills.length ? xpSum / kills.length : 0,
      motes: motes.length, motesPerHour: motes.length * 60 / durationMinutes, activePct,
      playerDamage: playerTotal, petDamage: petTotal,
      petShare: (playerTotal + petTotal) ? petTotal / (playerTotal + petTotal) * 100 : 0,
      damage, attempts, resists
    };
  }

  captureMetrics(ts) {
    const w = this.window(ts);
    if (w.kills >= this.minKills) this.metricHistory.push({ ts, xpPerMinute: w.xpPerMinute, killsPerMinute: w.killsPerMinute, xpPerKill: w.xpPerKill });
  }

  evaluateStatus(now = this.lastTs || Date.now()) {
    const w = this.window(now);
    if (!this.lastCombatTs || now - this.lastCombatTs > 60_000) return { code: 'IDLE', severity: 'neutral', message: 'Waiting for combat activity.' };
    if (this.levelChangedAt && now - this.levelChangedAt < 90_000) return { code: 'REBASELINING', severity: 'neutral', message: 'Level changed; rebuilding the current baseline.' };
    if (w.kills < this.minKills) return { code: 'LEARNING', severity: 'neutral', message: `Learning current farm (${w.kills}/${this.minKills} kills).` };
    const hist = this.metricHistory.slice(0, -1);
    const xpRef = hist.length >= 4 ? percentile(hist.map((x) => x.xpPerMinute), 0.75) : 0;
    const killRef = hist.length >= 4 ? percentile(hist.map((x) => x.killsPerMinute), 0.75) : 0;
    const xpBelowTarget = this.xpTarget > 0 && w.xpPerMinute < this.xpTarget;
    const killBelowTarget = this.killTarget > 0 && w.killsPerMinute < this.killTarget;
    if ((xpRef && w.xpPerMinute < xpRef * 0.78) || xpBelowTarget) {
      if ((killRef && w.killsPerMinute >= killRef * 0.85) && w.xpPerKill < median(hist.map((x) => x.xpPerKill)) * 0.85) {
        return { code: 'MOVE_DEEPER', severity: 'warn', message: 'XP per kill is falling while kill speed remains healthy. Consider tougher mobs nearby.' };
      }
      if ((killRef && w.killsPerMinute < killRef * 0.72) || killBelowTarget) {
        return { code: 'TOO_HARD', severity: 'warn', message: 'Kill throughput has dropped enough to hurt XP/min. Easier mobs may be more efficient.' };
      }
      return { code: 'SOFTENING', severity: 'warn', message: 'XP/min is below the recent reference rate.' };
    }
    return { code: 'HEALTHY', severity: 'good', message: 'Current farm is performing near its recent reference rate.' };
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

  procAlerts(now = this.lastTs || Date.now()) {
    const alerts = [];
    for (const [effect, state] of this.triggeredEffects.entries()) {
      if (state.count >= 3 && now - state.lastSeen <= this.windowMinutes * 60_000) alerts.push({ code: 'TRIGGERED_EFFECT', severity: 'info', message: `Unmapped automatic effect observed: ${effect} (${state.count} times).` });
    }
    for (const proc of this.profile?.procs || []) {
      const key = `${proc.slot}:${proc.effectName}`, baseline = this.procBaselines.get(key);
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
      level: this.level, zone, pet: this.currentPet?.name || null, metrics: w, status,
      procAlerts: this.procAlerts(now), damageBreakdown: this.damageBreakdown(now), mobMix: this.mobMix(now), recentLevels: this.levelHistory.slice(-8)
    };
  }
}

module.exports = { MonitorEngine, normalizeName };
