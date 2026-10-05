import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { createFighterFromNumber } from '../server/fighters.js';

function newStore() {
  return new Store({ persist: false });
}

test('抽号入池 + 去重', () => {
  const store = newStore();
  const f = createFighterFromNumber(5);
  store.addFighter(f);
  store.addFighter(createFighterFromNumber(5));
  assert.equal(store.listFighters().length, 1);
});

test('takeNextNumber 递增', () => {
  const store = newStore();
  assert.equal(store.takeNextNumber(), 1);
  assert.equal(store.takeNextNumber(), 2);
});

test('战绩累计与胜率计算', () => {
  const store = newStore();
  const a = store.addFighter(createFighterFromNumber(1));
  const b = store.addFighter(createFighterFromNumber(2));
  store.applyOutcome({ fighters: [a.id, b.id], winner: a.id });
  store.applyOutcome({ fighters: [a.id, b.id], winner: b.id });
  store.applyOutcome({ fighters: [a.id, b.id], winner: null });
  const board = store.leaderboard();
  const fa = board.find((x) => x.id === a.id);
  assert.equal(fa.wins, 1);
  assert.equal(fa.losses, 1);
  assert.equal(fa.draws, 1);
  assert.equal(fa.winRate, 0.5);
  assert.equal(board[0].id, fa.id);
});

test('重置清空所有数据', () => {
  const store = newStore();
  store.addFighter(createFighterFromNumber(1));
  store.reset();
  assert.equal(store.listFighters().length, 0);
  assert.equal(store.leaderboard().length, 0);
  assert.equal(store.snapshot().nextNumber, 1);
});
