import test from 'node:test';
import assert from 'node:assert/strict';
import { createFighterFromNumber } from '../engine/fighters.js';
import { simulateBattle, simulateSeries } from '../engine/battle.js';

function pair(a, b) {
  return [createFighterFromNumber(a), createFighterFromNumber(b)];
}

test('对撞结果结构完整', () => {
  const [a, b] = pair(7, 13);
  const r = simulateBattle(a, b, { seed: 1 });
  assert.ok(['ko', 'decision', 'draw', 'double-ko'].includes(r.method));
  assert.equal(r.rounds >= 1, true);
  assert.equal(r.events.length > 0, true);
  assert.ok(r.fighters.includes(a.id) && r.fighters.includes(b.id));
  for (const ev of r.events) {
    assert.ok(['hit', 'critical', 'miss'].includes(ev.type));
    assert.ok(ev.hp[a.id] !== undefined && ev.hp[b.id] !== undefined);
  }
});

test('伤害不会为负，血量不会为负', () => {
  for (let s = 0; s < 40; s++) {
    const [a, b] = pair(s, s + 100);
    const r = simulateBattle(a, b, { seed: s });
    for (const ev of r.events) {
      assert.ok(ev.damage >= 0);
      assert.ok(ev.hp[a.id] >= 0 && ev.hp[b.id] >= 0);
    }
    assert.ok(r.finalHp[a.id] >= 0 && r.finalHp[b.id] >= 0);
  }
});

test('有明确胜者时 winner 必为其中一方', () => {
  const [a, b] = pair(3, 9);
  const r = simulateBattle(a, b, { seed: 5 });
  if (r.method === 'ko' || r.method === 'decision') {
    assert.ok(r.winner === a.id || r.winner === b.id);
  } else {
    assert.equal(r.winner, null);
  }
});

test('系列赛局数上限与冠军判定正确', () => {
  const [a, b] = pair(21, 55);
  const series = simulateSeries(a, b, { bestOf: 5, seed: 7 });
  assert.ok(series.games.length <= 5);
  assert.ok(series.winsA + series.winsB <= series.games.length);
  if (series.champion) {
    assert.ok(series.champion === a.id || series.champion === b.id);
  }
});

test('同一种子结果可复现', () => {
  const [a, b] = pair(77, 88);
  const r1 = simulateBattle(a, b, { seed: 3 });
  const r2 = simulateBattle(a, b, { seed: 3 });
  assert.deepEqual(r1.finalHp, r2.finalHp);
  assert.equal(r1.winner, r2.winner);
  assert.equal(r1.rounds, r2.rounds);
});
