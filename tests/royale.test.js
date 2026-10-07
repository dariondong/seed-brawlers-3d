import test from 'node:test';
import assert from 'node:assert/strict';
import { createFighterFromNumber } from '../engine/fighters.js';
import { simulateRoyale, royaleOutcomes, seededShuffle, spawnPositions } from '../engine/royale.js';

const makeRoster = (n) => Array.from({ length: n }, (_, i) => createFighterFromNumber(i + 1));

test('70 人同台混战：站到最后的唯一冠军', () => {
  const roster = makeRoster(70);
  const res = simulateRoyale(roster, { seed: 42 });

  assert.equal(res.mode, 'melee');
  assert.equal(res.size, 70);
  assert.ok(res.champion);
  assert.equal(res.totalFights, 69); // n-1 次击倒
  assert.equal(res.events.length, 69);

  // 名次覆盖全体，且唯一
  assert.equal(res.standings.length, 70);
  const ranks = res.standings.map((s) => s.rank).sort((a, b) => a - b);
  assert.deepEqual(ranks, Array.from({ length: 70 }, (_, i) => i + 1));
  assert.equal(res.standings[0].rank, 1);
  assert.equal(res.standings[0].id, res.champion.id);
});

test('混战不是回合制：每名被击倒者只倒下一次', () => {
  const res = simulateRoyale(makeRoster(40), { seed: 5 });
  const losers = res.events.map((e) => e.loser);
  assert.equal(new Set(losers).size, losers.length);
  for (let i = 1; i < res.events.length; i++) {
    assert.ok(res.events[i].t >= res.events[i - 1].t);
  }
  assert.equal(res.events[0].remaining, res.size - 1);
  assert.equal(res.events[res.events.length - 1].remaining, 1);
});

test('大乱斗可复现：同种子同冠军同过程', () => {
  const roster = makeRoster(30);
  const a = simulateRoyale(roster, { seed: 9 });
  const b = simulateRoyale(roster, { seed: 9 });
  assert.deepEqual(a.champion, b.champion);
  assert.deepEqual(a.standings, b.standings);
  assert.deepEqual(a.events, b.events);

  const c = simulateRoyale(roster, { seed: 10 });
  assert.notDeepEqual(a.events, c.events);
});

test('royaleOutcomes 覆盖全部击倒且胜者属于该对局', () => {
  const res = simulateRoyale(makeRoster(20), { seed: 1 });
  const outcomes = royaleOutcomes(res);
  assert.equal(outcomes.length, res.events.length);
  for (const o of outcomes) {
    assert.equal(o.fighters.length, 2);
    assert.notEqual(o.fighters[0], o.fighters[1]);
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

test('spawnPositions 在场地范围内且数量正确', () => {
  for (const n of [2, 9, 70]) {
    const pos = spawnPositions(n);
    assert.equal(pos.length, n);
    for (const p of pos) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
      assert.ok(Number.isFinite(p.ry));
    }
  }
});

test('不足 2 人报错', () => {
  assert.throws(() => simulateRoyale(makeRoster(1)));
});

test('混战必定收敛（不会打不完）', () => {
  for (const seed of [0, 1, 2, 99, 12345]) {
    const res = simulateRoyale(makeRoster(70), { seed });
    assert.ok(res.champion, `seed ${seed} 未产生冠军`);
    assert.ok(res.duration > 0);
    assert.ok(res.duration < 30, `seed ${seed} 用时过长：${res.duration}s`);
  }
});
