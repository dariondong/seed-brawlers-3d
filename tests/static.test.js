import test from 'node:test';
import assert from 'node:assert/strict';
import { syncEngine } from '../scripts/sync-engine.mjs';
import { LocalBackend } from '../public/backend.js';

test('public/engine 与 engine 保持一致（Pages 静态拷贝不漂移）', () => {
  const drift = syncEngine({ check: true });
  assert.deepEqual(drift, [], `以下文件不一致：${drift.join(', ')}`);
});

// Node 环境没有 localStorage，用内存实现即可测试浏览器内置后端。
function withLocalStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
  return map;
}

test('静态模式：内置后端跑通抽号 → 同台大乱斗 → 唯一冠军', async () => {
  withLocalStorage();
  const backend = new LocalBackend();

  await backend.drawBatch(20);
  const board = await backend.leaderboard();
  assert.equal(board.leaderboard.length, 20);

  const out = await backend.royale({ seed: 42 });
  assert.equal(out.size, 20);
  assert.ok(out.result.champion);
  assert.equal(out.result.totalFights, 19);

  const totalGames = out.leaderboard.reduce((n, f) => n + f.wins + f.losses, 0);
  assert.equal(totalGames, 38);
});

test('静态模式：数据写入 localStorage，可跨实例恢复', async () => {
  const map = withLocalStorage();
  const first = new LocalBackend();
  await first.roster({ text: '赵子龙,关云长', mode: 'replace' });

  // 等待防抖写入落盘
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(map.size > 0);

  const second = new LocalBackend();
  const state = await second.state();
  assert.deepEqual(state.fighters.map((f) => f.name), ['赵子龙', '关云长']);
});
