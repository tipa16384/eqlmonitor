'use strict';

const ITEMS = {
  5403: { name: 'Ghoulbane', weaponType: '1H Slash', damageType: 'slash' },
  7257: { name: "Serpent's Tooth", weaponType: '1H Pierce', damageType: 'pierce' }
};

const ABILITIES = {
  'Smiting Strike': { category: 'triggered', triggeredBy: 'smite', damageType: 'magic' },
  'Condemnation of Nife': { category: 'innate_proc', source: 'class', sourceClass: 'Paladin' },
  'Chaotic Feedback': { category: 'direct_spell', damageType: 'magic' },
  'Choke': { category: 'dot_spell', damageType: 'magic' },
  'Slay Undead': { category: 'modifier' }
};

module.exports = { ITEMS, ABILITIES };
