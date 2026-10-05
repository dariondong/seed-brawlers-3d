import test from 'node:test';
import assert from 'node:assert/strict';
import { createFighterFromNumber, compareFighters } from '../engine/fighters.js';
import { createRng } from '../engine/rng.js';

test('同一个号码总是生成完全相同的小人（外观/属性/姓名）', () => {
  const { createdAt: _a, ...a } = createFighterFromNumber(42);
  const { createdAt: _b, ...b } = createFighterFromNumber(42);
  assert.deepEqual(a, b);
});

test('不同号码生成不同的小人', () => {
  const a = createFighterFromNumber(1);
  const b = createFighterFromNumber(2);
  assert.notDeepEqual(a.body, b.body);
});

test('属性落在合理范围内', () => {
  for (let n = 0; n < 200; n++) {
    const f = createFighterFromNumber(n);
    for (const key of ['power', 'speed', 'toughness', 'technique']) {
      assert.ok(f.stats[key] >= 8 && f.stats[key] <= 99, `${key}=${f.stats[key]}`);
    }
    assert.ok(f.derived.maxHp > 0);
    assert.ok(f.derived.attack > 0);
    assert.ok(f.derived.defense >= 0);
    assert.ok(f.derived.critChance >= 0.03 && f.derived.critChance <= 0.32);
    assert.ok(f.power > 0);
    assert.ok(f.name.length > 0);
  }
});

test('rng 可复现', () => {
  const a = createRng('x', 1)();
  const b = createRng('x', 1)();
  assert.equal(a, b);
});

test('排行榜排序：胜率优先', () => {
  const mk = (wins, losses, power) => ({ wins, losses, power, number: 1, id: 'x', draws: 0 });
  const list = [mk(1, 3, 999), mk(3, 1, 100), mk(2, 2, 500)].sort(compareFighters);
  assert.equal(list[0].wins, 3);
  assert.equal(list[2].wins, 1);
});
