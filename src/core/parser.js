'use strict';

const VERB_MAP = {
  slash: 'slash', slashes: 'slash', pierce: 'pierce', pierces: 'pierce',
  bash: 'bash', bashes: 'bash', kick: 'kick', kicks: 'kick', strike: 'strike', strikes: 'strike',
  smite: 'smite', smites: 'smite', crush: 'crush', crushes: 'crush', punch: 'punch', punches: 'punch',
  shoot: 'shoot', shoots: 'shoot', cleave: 'cleave', cleaves: 'cleave', reave: 'reave', reaves: 'reave',
  bite: 'bite', bites: 'bite'
};

function parseTimestamp(line) {
  const m = line.match(/^\[([^\]]+)\]\s+(.*)$/);
  if (!m) return null;
  const ts = Date.parse(m[1]);
  if (!Number.isFinite(ts)) return null;
  return { ts, text: m[2], timestampText: m[1] };
}

function modifierFromTail(tail = '') {
  const m = tail.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : null;
}

function parseLine(line) {
  const base = parseTimestamp(line.trimEnd());
  if (!base) return null;
  const { ts, text } = base;
  let m;

  if ((m = text.match(/^You have gained a level! Welcome to level (\d+)!$/))) return { type: 'level', ts, level: Number(m[1]), raw: line };
  if ((m = text.match(/^You gain experience! \(([\d.]+)%\)$/))) return { type: 'xp', ts, percent: Number(m[1]), raw: line };
  if ((m = text.match(/^You have entered (.+)\.$/))) return { type: 'zone', ts, zone: m[1], raw: line };
  if ((m = text.match(/^(.+) has been charmed\.$/i))) return { type: 'charm_start', ts, pet: m[1], raw: line };
  if ((m = text.match(/^Your Charm spell has worn off of (.+)\.$/i))) return { type: 'charm_end', ts, pet: m[1], raw: line };
  if ((m = text.match(/^You begin casting (.+)\.$/))) return { type: 'cast_start', ts, spell: m[1], raw: line };
  if ((m = text.match(/^You looted (?:a|an) (Mote of .+?) from (.+?)(?:'s|s') corpse/))) return { type: 'mote', ts, mote: m[1], source: m[2], raw: line };
  if ((m = text.match(/^You have slain (.+)!$/))) return { type: 'kill', ts, target: m[1], killer: 'You', raw: line };
  if ((m = text.match(/^(.+) has been slain by (.+)!$/))) return { type: 'death', ts, target: m[1], killer: m[2], raw: line };
  if ((m = text.match(/^Auto attack is (on|off)\.$/))) return { type: 'auto_attack', ts, enabled: m[1] === 'on', raw: line };

  if ((m = text.match(/^You hit (.+?) for (\d+) points? of ([\w-]+) damage by (.+)\.$/))) {
    return { type: 'damage', ts, actor: 'You', target: m[1], amount: Number(m[2]), damageType: m[3].toLowerCase(), action: 'effect', effect: m[4], raw: line };
  }
  if ((m = text.match(/^(.+?) hit (.+?) for (\d+) points? of ([\w-]+) damage by (.+)\.$/i))) {
    return { type: 'damage', ts, actor: m[1], target: m[2], amount: Number(m[3]), damageType: m[4].toLowerCase(), action: 'effect', effect: m[5], raw: line };
  }
  if ((m = text.match(/^(.+?) has taken (\d+) damage from your (.+)\.$/i))) {
    return { type: 'damage', ts, actor: 'You', target: m[1], amount: Number(m[2]), damageType: 'unknown', action: 'dot', effect: m[3], raw: line };
  }
  if ((m = text.match(/^(.+?) has taken (\d+) damage from (.+?) by (.+)\.$/i))) {
    return { type: 'damage', ts, actor: m[4], target: m[1], amount: Number(m[2]), damageType: 'unknown', action: 'dot', effect: m[3], raw: line };
  }
  if ((m = text.match(/^(.+?) resisted your (.+)!$/i))) return { type: 'resist', ts, actor: 'You', target: m[1], effect: m[2], raw: line };

  if ((m = text.match(/^You (slash|pierce|bash|kick|strike|smite|crush|punch|shoot|cleave|reave|bite) (.+?) for (\d+) points? of damage\.(.*)$/i))) {
    return { type: 'damage', ts, actor: 'You', target: m[2], amount: Number(m[3]), damageType: VERB_MAP[m[1].toLowerCase()], action: VERB_MAP[m[1].toLowerCase()], modifier: modifierFromTail(m[4]), raw: line };
  }
  if ((m = text.match(/^(.+?) (slashes|pierces|bashes|kicks|strikes|smites|crushes|punches|shoots|cleaves|reaves|bites) (.+?) for (\d+) points? of damage\.(.*)$/i))) {
    return { type: 'damage', ts, actor: m[1], target: m[3], amount: Number(m[4]), damageType: VERB_MAP[m[2].toLowerCase()], action: VERB_MAP[m[2].toLowerCase()], modifier: modifierFromTail(m[5]), raw: line };
  }
  if ((m = text.match(/^You try to (slash|pierce|bash|kick|strike|smite|crush|punch|shoot|cleave|reave|bite) (.+?), but (.+)$/i))) {
    const outcomeText = m[3];
    let outcome = 'other';
    if (/miss/i.test(outcomeText)) outcome = 'miss';
    else if (/parr/i.test(outcomeText)) outcome = 'parry';
    else if (/dodg/i.test(outcomeText)) outcome = 'dodge';
    else if (/block/i.test(outcomeText)) outcome = 'block';
    else if (/magical skin absorbs/i.test(outcomeText)) outcome = 'absorb';
    return { type: 'attempt', ts, actor: 'You', target: m[2], action: VERB_MAP[m[1].toLowerCase()], outcome, raw: line };
  }
  if (/\bYOU\b/.test(text) && /(points? of damage|points? of \w+ damage)/i.test(text)) return { type: 'incoming_damage', ts, raw: line };
  return { type: 'other', ts, raw: line };
}

module.exports = { parseLine, parseTimestamp };
