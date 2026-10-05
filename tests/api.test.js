import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { createApp } from '../server/index.js';

function makeServer() {
  const store = new Store({ persist: false });
  const app = createApp({ store });
  const server = app.listen(0);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  return { server, base, store };
}

const post = (base, path, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });

test('完整流程：抽号 → 对撞 → 排行榜', async () => {
  const { server, base } = makeServer();
  try {
    const draw1 = await post(base, '/api/draw', { number: 10 }).then((r) => r.json());
    const draw2 = await post(base, '/api/draw', { number: 20 }).then((r) => r.json());
    assert.equal(draw1.created, true);
    assert.equal(draw1.fighter.number, 10);

    const dup = await post(base, '/api/draw', { number: 10 }).then((r) => r.json());
    assert.equal(dup.created, false);

    const battle = await post(base, '/api/battle', { a: 10, b: 20 }).then((r) => r.json());
    assert.ok(battle.result.winner === 'F10' || battle.result.winner === 'F20' || battle.result.winner === null);
    assert.equal(battle.leaderboard.length, 2);
    assert.ok(battle.leaderboard[0].total >= 1);

    const state = await fetch(`${base}/api/state`).then((r) => r.json());
    assert.equal(state.fighters.length, 2);
    assert.equal(state.battles.length, 1);
  } finally {
    server.close();
  }
});

test('号码非法时报错', async () => {
  const { server, base } = makeServer();
  try {
    const res = await post(base, '/api/draw', { number: -5 });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('对撞人数不足时报错', async () => {
  const { server, base } = makeServer();
  try {
    await post(base, '/api/draw', { number: 1 });
    const res = await post(base, '/api/battle', {});
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('系列赛返回 games', async () => {
  const { server, base } = makeServer();
  try {
    await post(base, '/api/draw', { number: 3 });
    await post(base, '/api/draw', { number: 4 });
    const res = await post(base, '/api/battle', { a: 3, b: 4, bestOf: 5 }).then((r) => r.json());
    assert.equal(res.bestOf, 5);
    assert.ok(Array.isArray(res.result.games));
    assert.ok(res.result.games.length <= 5);
  } finally {
    server.close();
  }
});

test('70 人大乱斗：返回唯一冠军并更新战绩', async () => {
  const { server, base } = makeServer();
  try {
    const batch = await post(base, '/api/draw/batch', { count: 70 }).then((r) => r.json());
    assert.equal(batch.fighters.length, 70);

    const res = await post(base, '/api/royale', { seed: 123 }).then((r) => r.json());
    assert.equal(res.size, 70);
    assert.ok(res.result.champion);
    assert.equal(res.result.totalFights, 69);
    assert.equal(res.result.rounds.length, 7);

    // 战绩已写回：总共应有 69 场对局被记录
    const totalGames = res.leaderboard.reduce((n, f) => n + f.wins + f.losses, 0);
    assert.equal(totalGames, 138); // 每场 1 胜 1 负
  } finally {
    server.close();
  }
});

test('大乱斗人数不足时报错', async () => {
  const { server, base } = makeServer();
  try {
    await post(base, '/api/draw', { number: 1 });
    const res = await post(base, '/api/royale', {});
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('自定义名单：逗号/换行混合 + 自定义姓名生效', async () => {
  const { server, base } = makeServer();
  try {
    const res = await post(base, '/api/roster', { text: '赵子龙，关云长、张翼德\n马孟起', mode: 'replace' }).then((r) => r.json());
    assert.equal(res.count, 4);
    assert.deepEqual(
      res.fighters.map((f) => f.name),
      ['赵子龙', '关云长', '张翼德', '马孟起'],
    );
    assert.deepEqual(
      res.fighters.map((f) => f.number),
      [1, 2, 3, 4],
    );
    assert.ok(res.fighters.every((f) => f.custom === true));
    // 属性仍由号码决定：确定性
    const again = await post(base, '/api/roster', { text: '赵子龙,关云长,张翼德,马孟起', mode: 'replace' }).then((r) => r.json());
    assert.deepEqual(again.fighters[0].stats, res.fighters[0].stats);
  } finally {
    server.close();
  }
});

test('自定义名单：replace 从 1 号开始且战绩清零', async () => {
  const { server, base } = makeServer();
  try {
    await post(base, '/api/roster', { text: 'A,B', mode: 'replace' });
    await post(base, '/api/battle', { a: 1, b: 2 });

    const res = await post(base, '/api/roster', { text: '新甲,新乙', mode: 'replace' }).then((r) => r.json());
    assert.deepEqual(res.fighters.map((f) => f.name), ['新甲', '新乙']);
    const totalGames = res.leaderboard.reduce((n, f) => n + f.wins + f.losses, 0);
    assert.equal(totalGames, 0);
  } finally {
    server.close();
  }
});

test('自定义名单：append 排在现有号码之后', async () => {
  const { server, base } = makeServer();
  try {
    await post(base, '/api/roster', { text: '甲,乙', mode: 'replace' });
    const res = await post(base, '/api/roster', { text: '丙,丁', mode: 'append' }).then((r) => r.json());
    assert.equal(res.count, 2);
    assert.deepEqual(res.fighters.map((f) => f.number), [3, 4]);
  } finally {
    server.close();
  }
});

test('自定义名单：空名单报错', async () => {
  const { server, base } = makeServer();
  try {
    const res = await post(base, '/api/roster', { text: '   ,  ,\n ' });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('改名接口', async () => {
  const { server, base } = makeServer();
  try {
    await post(base, '/api/roster', { text: '甲,乙', mode: 'replace' });
    const res = await post(base, '/api/roster/rename', { number: 1, name: '改名成功' }).then((r) => r.json());
    assert.equal(res.fighter.name, '改名成功');
    const missing = await post(base, '/api/roster/rename', { number: 99, name: 'x' });
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});
