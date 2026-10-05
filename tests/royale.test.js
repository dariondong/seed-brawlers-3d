import test from 'node:test';
import assert from 'node:assert/strict';
import { createFighterFromNumber } from '../engine/fighters.js';
import { simulateRoyale, royaleOutcomes, seededShuffle } from '../engine/royale.js';

const makeRoster = (n) => Array.from({ length: n }, (_, i) => createFighterFromNumber(i + 1));

test('70 人同台：逐轮淘汰直到唯一冠军', () => {
  const roster = makeRoster(70);
  const res = simulateRoyale(roster, { seed: 42 });

  assert.equal(res.size, 70);
  assert.ok(res.champion);
  assert.equal(res.totalFights, 69); // n-1 场淘汰赛

  // 每轮场上人数 = 上一轮的一半（向上取整）
  const sizes = res.rounds.map((r) => r.fights.length * 2 + (r.bye ? 1 : 0));
  assert.equal(sizes[0], 70);
  for (let i = 1; i < sizes.length; i++) {
    assert.equal(sizes[i], Math.ceil(sizes[i - 1] / 2));
  }
  assert.equal(sizes[sizes.length - 1], 2);
});

test('大乱斗可复现：同种子同冠军', () => {
  const roster = makeRoster(40);
  const a = simulateRoyale(roster, { seed: 9 });
  const b = simulateRoyale(roster, { seed: 9 });
  assert.deepEqual(a.champion, b.champion);
  assert.equal(a.totalFights, b.totalFights);
});

test('每场对局胜者确实晋级，败者不再出现', () => {
  const roster = makeRoster(16);
  const res = simulateRoyale(roster, { seed: 3 });
  for (let i = 0; i < res.rounds.length - 1; i++) {
    const survivors = new Set(res.rounds[i].survivors.map((s) => s.id));
    const nextIds = new Set();
    for (const f of res.rounds[i + 1].fights) {
      nextIds.add(f.a);
      nextIds.add(f.b);
    }
    if (res.rounds[i + 1].bye) nextIds.add(res.rounds[i + 1].bye.id);
    for (const id of nextIds) assert.ok(survivors.has(id), `${id} 未在上一轮晋级`);
  }
  assert.equal(res.rounds[res.rounds.length - 1].survivors.length, 1);
});

test('royaleOutcomes 覆盖全部对局', () => {
  const res = simulateRoyale(makeRoster(10), { seed: 1 });
  const outcomes = royaleOutcomes(res);
  assert.equal(outcomes.length, res.totalFights);
  for (const o of outcomes) {
    assert.ok(o.fighters.length === 2);
    assert.ok(o.winner === o.fighters[0] || o.winner === o.fighters[1]);
  }
});

test('seededShuffle 确定性且为排列', () => {
  const arr = makeRoster(20).map((f) => f.id);
  const s1 = seededShuffle(arr, 7);
  const s2 = seededShuffle(arr, 7);
  assert.deepEqual(s1, s2);
  assert.deepEqual([...s1].sort(), [...arr].sort());
});

test('不足 2 人报错', () => {
  assert.throws(() => simulateRoyale(makeRoster(1)));
});
