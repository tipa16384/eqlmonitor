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
