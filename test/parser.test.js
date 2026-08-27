'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLine } = require('../src/core/parser');
const prefix = '[Wed Aug 26 20:21:11 2026] ';

test('parses XP and level events', () => {
  assert.equal(parseLine(prefix + 'You gain experience! (1.094%)').percent, 1.094);
  assert.equal(parseLine(prefix + 'You have gained a level! Welcome to level 12!').level, 12);
});

test('parses player physical and effect damage', () => {
  const physical = parseLine(prefix + 'You slash a sturdy skeleton for 51 points of damage.');
  assert.equal(physical.action, 'slash'); assert.equal(physical.amount, 51);
  const effect = parseLine(prefix + 'You hit a sturdy skeleton for 56 points of magic damage by Smiting Strike.');
  assert.equal(effect.effect, 'Smiting Strike'); assert.equal(effect.damageType, 'magic');
});

test('parses charm and mote events', () => {
  assert.equal(parseLine(prefix + 'a skeletal excavator has been charmed.').pet, 'a skeletal excavator');
  const mote = parseLine(prefix + "You looted a Mote of Lesser Potential from a greater skeleton's corpse and stored it in your currency");
  assert.equal(mote.mote, 'Mote of Lesser Potential'); assert.equal(mote.source, 'a greater skeleton');
});

test('parses pet kill and absorb outcome', () => {
  const death = parseLine(prefix + 'A necro initiate has been slain by a skeletal excavator!');
  assert.equal(death.killer, 'a skeletal excavator');
  const attempt = parseLine(prefix + "You try to kick Kahaptra Z`Taj, but Kahaptra Z`Taj's magical skin absorbs the blow!");
  assert.equal(attempt.outcome, 'absorb');
});

test('parses progression, fizzle, and blocked weapon proc events', () => {
  assert.equal(parseLine(prefix + 'You have gained the ability to use Feign Death.').ability, 'Feign Death');
  assert.equal(parseLine(prefix + 'You have finished memorizing Sanity Warp.').spell, 'Sanity Warp');
  assert.equal(parseLine(prefix + 'Your Sanity Warp spell fizzles!').type, 'spell_fizzle');
  const blocked = parseLine(prefix + 'Your will is not sufficient to command this weapon.');
  assert.equal(blocked.type, 'proc_blocked');
  assert.equal(blocked.reason, 'weapon_level_requirement');
});

test('parses invocation, heal, overheal, and Mend events', () => {
  assert.equal(parseLine(prefix + 'You begin reciting the spellblade invocation.').name, 'spellblade');
  const heal = parseLine(prefix + 'You healed Tipa for 14 (67) hit points by Light Healing.');
  assert.equal(heal.type, 'heal');
  assert.equal(heal.amount, 14);
  assert.equal(heal.potential, 67);
  assert.equal(heal.spell, 'Light Healing');
  const petHeal = parseLine(prefix + 'a Teir`Dal ranger healed you for 66 hit points by Light Healing.');
  assert.equal(petHeal.actor, 'a Teir`Dal ranger');
  assert.equal(petHeal.target, 'you');
  assert.equal(parseLine(prefix + 'You mend your wounds and heal some damage.').type, 'mend');
});

test('parses stance, reactive damage, pet attempts, and heal-over-time', () => {
  const stance = parseLine(prefix + 'You assume an offensive stance.');
  assert.equal(stance.type, 'stance');
  assert.equal(stance.name, 'offensive');

  const reactive = parseLine(prefix + 'Master Yael is burned by YOUR flames for 11 points of non-melee damage.');
  assert.equal(reactive.type, 'damage');
  assert.equal(reactive.actor, 'You');
  assert.equal(reactive.target, 'Master Yael');
  assert.equal(reactive.amount, 11);
  assert.equal(reactive.action, 'reactive');
  assert.equal(reactive.reactiveEffect, 'flames');

  const petAttempt = parseLine(prefix + "A flighty fiend tries to slash Master Yael, but Master Yael's magical skin absorbs the blow!");
  assert.equal(petAttempt.type, 'attempt');
  assert.equal(petAttempt.actor, 'A flighty fiend');
  assert.equal(petAttempt.outcome, 'absorb');

  const hot = parseLine(prefix + 'You healed Tipa over time for 191 (297) hit points by Sacred Echo.');
  assert.equal(hot.type, 'heal');
  assert.equal(hot.amount, 191);
  assert.equal(hot.potential, 297);
  assert.equal(hot.spell, 'Sacred Echo');
  assert.equal(hot.overTime, true);
});
