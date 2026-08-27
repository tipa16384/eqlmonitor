'use strict';

const fs = require('node:fs');
const { ITEMS } = require('./catalog');

function normalizeProfile(raw) {
  const equipment = {};
  const equipped = raw.equipped || {};
  const ids = raw.equippedItemIDs || {};
  const upgrades = raw.slotUpgrades || {};
  const exaltationSlots = raw.exaltations?.slots || {};

  for (const [slot, slug] of Object.entries(equipped)) {
    if (!slug) continue;
    const itemId = ids[slot] ?? null;
    const catalog = itemId != null ? ITEMS[itemId] : null;
    const sockets = exaltationSlots[slot]?.sockets || {};
    const effects = Object.values(sockets).map((effect) => ({
      type: effect.type,
      effectName: effect.effectName,
      itemName: effect.itemName,
      sourceSlot: effect.sourceSlot
    }));
    equipment[slot] = {
      slot,
      slug,
      itemId,
      upgrade: upgrades[slot] ?? 0,
      name: catalog?.name || slug.replace(/^item:/, ''),
      weaponType: catalog?.weaponType || null,
      damageType: catalog?.damageType || null,
      effects
    };
  }

  const procs = [];
  for (const [slot, slotData] of Object.entries(exaltationSlots)) {
    for (const effect of Object.values(slotData?.sockets || {})) {
      if (effect.type === 'proc') {
        procs.push({ slot, effectName: effect.effectName, itemName: effect.itemName, itemId: ids[slot] ?? null });
      }
    }
  }

  return {
    schemaVersion: raw.version ?? null,
    exportedAt: raw.exportedAt ?? null,
    source: raw.source ?? null,
    name: raw.name ?? 'Unknown',
    race: raw.race ?? null,
    classes: Array.isArray(raw.classes) ? raw.classes : [],
    equipment,
    procs,
    aaRanks: raw.aaRanks || {}
  };
}

function loadProfile(filePath) {
  return normalizeProfile(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

module.exports = { normalizeProfile, loadProfile };
