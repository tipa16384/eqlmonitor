'use strict';

const $ = (id) => document.getElementById(id);
const fmt = (n, digits = 2) => Number.isFinite(n) ? n.toFixed(digits) : '0.00';
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

function render(snapshot) {
  const c = snapshot.character;
  $('character').textContent = c?.name || 'No profile';
  $('build').textContent = c ? `${c.race || ''} · ${c.classes.join(' / ')}` : '—';
  $('level').textContent = snapshot.level ?? '—';
  $('zone').textContent = snapshot.zone || 'Unknown';
  $('pet').textContent = snapshot.pet || 'None';
  const m = snapshot.metrics;
  $('xpMin').textContent = `${fmt(m.xpPerMinute)}%`;
  $('xpDetail').textContent = `${fmt(m.xpPercent, 1)}% in ${fmt(m.durationMinutes, 1)} min`;
  $('killsMin').textContent = fmt(m.killsPerMinute);
  $('killDetail').textContent = `${m.kills} kills · ${fmt(m.xpPerKill, 2)}% XP/kill`;
  $('motesHour').textContent = fmt(m.motesPerHour);
  $('moteDetail').textContent = `${m.motes} observed in window`;
  $('activePct').textContent = `${fmt(m.activePct, 0)}%`;
  $('petShare').textContent = `Pet: ${fmt(m.petShare, 0)}% of tracked output`;
  const status = snapshot.status;
  $('statusPanel').className = `status panel ${status.severity || 'neutral'}`;
  $('statusCode').textContent = status.code.replaceAll('_', ' ');
  $('statusMessage').textContent = status.message;
  const anomalyBox = $('anomalies');
  if (snapshot.procAlerts?.length) anomalyBox.innerHTML = snapshot.procAlerts.map((a) => `<div class="anomaly">${escapeHtml(a.message)}</div>`).join('');
  else { anomalyBox.className = 'empty'; anomalyBox.textContent = 'No anomalies detected.'; }
  const weapons = [];
  if (c?.primary) weapons.push(`PRIMARY: ${c.primary.name} +${c.primary.upgrade}${c.primary.damageType ? ` · ${c.primary.damageType}` : ''}`);
  if (c?.secondary) weapons.push(`SECONDARY: ${c.secondary.name} +${c.secondary.upgrade}${c.secondary.damageType ? ` · ${c.secondary.damageType}` : ''}`);
  if (c?.procs?.length) weapons.push(...c.procs.map((p) => `PROC: ${p.itemName || p.slot} → ${p.effectName}`));
  $('weapons').innerHTML = weapons.map((w) => `<div>${escapeHtml(w)}</div>`).join('');
  $('mobMix').innerHTML = (snapshot.mobMix || []).length ? snapshot.mobMix.map((x) => `<div>${escapeHtml(x.name)} · ${x.kills} kills</div>`).join('') : '<div class="empty">No recent kills.</div>';
  const rows = snapshot.damageBreakdown || [];
  $('damageBody').innerHTML = rows.length ? rows.map((r) => `<tr><td>${escapeHtml(r.owner)}</td><td>${escapeHtml(r.label)}</td><td>${escapeHtml(r.damageType || r.category || '')}</td><td>${r.hits}</td><td>${r.damage}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">No combat data.</td></tr>';
  $('profilePath').textContent = snapshot.paths?.profile || '—';
  $('logPath').textContent = snapshot.paths?.log || '—';
}

$('profileButton').addEventListener('click', () => window.eqlMonitor.chooseProfile());
$('logButton').addEventListener('click', () => window.eqlMonitor.chooseLog());
$('applySettings').addEventListener('click', () => window.eqlMonitor.setSettings({
  windowMinutes: Number($('windowMinutes').value), minKills: Number($('minKills').value),
  xpTarget: Number($('xpTarget').value), killTarget: Number($('killTarget').value),
  zoneOverride: $('zoneOverride').value.trim() || null
}));
window.eqlMonitor.onSnapshot(render);
window.eqlMonitor.getSnapshot().then(render);
