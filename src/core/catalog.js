'use strict';

const ITEMS = {
  5403: { name: 'Ghoulbane', weaponType: '1H Slash', damageType: 'slash' },
  7257: { name: "Serpent's Tooth", weaponType: '1H Pierce', damageType: 'pierce' }
};

const ABILITIES = {
  'Smiting Strike': { category: 'triggered', triggeredBy: 'smite', damageType: 'magic' },
  'Condemnation of Nife': { category: 'innate_proc', source: 'class', sourceClass: 'Paladin', targetAffinity: 'undead' },
  'Chaotic Feedback': { category: 'direct_spell', damageType: 'magic' },
  'Sanity Warp': { category: 'direct_spell', damageType: 'magic' },
  'Choke': { category: 'dot_spell', damageType: 'magic' },
  'Gasping Embrace': { category: 'dot_spell', damageType: 'magic' },
  'Earthquake': { category: 'item_proc', source: 'item', itemName: 'Earthshaker', damageType: 'magic' },
  'Boil Blood': { category: 'item_proc', source: 'item', itemName: 'BloodFire' },
  'Puma Maw': { category: 'buff_proc', source: 'buff', buffName: 'Spirit of Puma' },
  'Puma Maw II': { category: 'buff_proc', source: 'buff', buffName: 'Spirit of Puma' },
  'Mesmerization III': { category: 'control_spell' },
  'Slay Undead': { category: 'modifier', targetAffinity: 'undead' }
};

module.exports = { ITEMS, ABILITIES };
