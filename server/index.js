import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { createFighterFromNumber } from './fighters.js';
import { simulateBattle, simulateSeries } from './battle.js';
import { simulateRoyale, royaleOutcomes } from './royale.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

export function createApp({ store = new Store() } = {}) {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'seed-brawlers-3d' });
  });

  app.get('/api/state', (_req, res) => {
    res.json(store.snapshot());
  });

  // 抽号：给定号码或自动抽取下一个号码，确定性地生成一个小人。
  app.post('/api/draw', (req, res) => {
    const body = req.body || {};
    let number;
    if (body.number === undefined || body.number === null || body.number === '') {
      number = store.takeNextNumber();
    } else {
      number = Number(body.number);
      if (!Number.isFinite(number) || number < 0 || number > 1e9) {
        return res.status(400).json({ error: '号码必须是 0 到 1e9 之间的数字' });
      }
    }

    const existing = store.getFighter(number);
    const fighter = existing || store.addFighter(createFighterFromNumber(number));
    res.status(existing ? 200 : 201).json({
      created: !existing,
      fighter,
    });
  });

  // 一次抽取多个号码（最多 70 名，用于同台大乱斗）。
  app.post('/api/draw/batch', (req, res) => {
    const count = Math.min(70, Math.max(1, Number((req.body || {}).count) || 2));
    const created = [];
    for (let i = 0; i < count; i++) {
      const number = store.takeNextNumber();
      created.push(store.getFighter(number) || store.addFighter(createFighterFromNumber(number)));
    }
    res.status(201).json({ fighters: created });
  });

  // 对撞搏斗：可传入双方号码，未指定则自动挑选两名小人。
  app.post('/api/battle', (req, res) => {
    const body = req.body || {};
    const fighters = store.listFighters();

    let a = body.a !== undefined ? store.getFighter(body.a) : null;
    let b = body.b !== undefined ? store.getFighter(body.b) : null;

    if (body.a !== undefined && !a) return res.status(404).json({ error: `号码 ${body.a} 尚未抽取` });
    if (body.b !== undefined && !b) return res.status(404).json({ error: `号码 ${body.b} 尚未抽取` });

    if (!a && !b) {
      if (fighters.length < 2) {
        return res.status(400).json({ error: '至少需要抽取 2 个小人才能对撞' });
      }
      const shuffled = [...fighters].sort(() => Math.random() - 0.5);
      a = shuffled[0];
      b = shuffled[1];
    } else if (!a) {
      a = fighters.find((f) => f.id !== b.id);
    } else if (!b) {
      b = fighters.find((f) => f.id !== a.id);
    }

    if (!a || !b || a.id === b.id) {
      return res.status(400).json({ error: '无法选定两个不同的小人' });
    }

    const bestOf = Math.min(9, Math.max(1, Number(body.bestOf) || 1));
    const result =
      bestOf > 1
        ? simulateSeries(a, b, { bestOf, seed: body.seed || 0 })
        : simulateBattle(a, b, { seed: body.seed || 0 });

    const record = bestOf > 1 ? result.games[result.games.length - 1] : result;
    store.recordBattle(record);
    if (bestOf > 1) {
      for (const game of result.games) store.applyOutcome(game);
    } else {
      store.applyOutcome(record);
    }

    res.json({
      result,
      bestOf,
      leaderboard: store.leaderboard(),
    });
  });

  app.get('/api/leaderboard', (_req, res) => {
    res.json({ leaderboard: store.leaderboard() });
  });

  // 自定义名单：粘贴一批名字（或 {"names":[...]} / {"text":"每行一个"}）。
  // 逐个分配号码并用号码确定性地生成属性；同名同号时可复现。
  app.post('/api/roster', (req, res) => {
    const body = req.body || {};
    let names = [];
    if (Array.isArray(body.names)) {
      names = body.names.map((s) => String(s).trim()).filter(Boolean);
    } else if (typeof body.text === 'string') {
      names = body.text
        .split(/[\n,，、;；]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    names = names.slice(0, 70).map((s) => s.slice(0, 24));
    if (!names.length) {
      return res.status(400).json({ error: '名单为空，请输入至少一个姓名' });
    }

    const startNo = Number.isInteger(body.startNumber) && body.startNumber >= 0 ? body.startNumber : store.state.nextNumber;
    const mode = body.mode === 'replace' ? 'replace' : 'append';
    if (mode === 'replace') store.reset();
    const base = mode === 'replace' ? 1 : startNo;

    const fighters = [];
    names.forEach((name, i) => {
      const number = base + i;
      const fighter = createFighterFromNumber(number, { name });
      fighters.push(store.upsertFighter(fighter));
      if (number >= store.state.nextNumber) store.state.nextNumber = number + 1;
    });
    store.flushNow();

    res.status(201).json({ mode, count: fighters.length, fighters, leaderboard: store.leaderboard() });
  });

  // 改名：自定义名单里点名字即可改。
  app.post('/api/roster/rename', (req, res) => {
    const { number, name } = req.body || {};
    if (number === undefined || !name) {
      return res.status(400).json({ error: '需要提供 number 与 name' });
    }
    const updated = store.renameFighter(Number(number), name);
    if (!updated) return res.status(404).json({ error: `号码 ${number} 尚未抽取` });
    res.json({ fighter: updated });
  });

  // 大乱斗：所有（或指定数量）小人同台，逐轮两两对撞淘汰，决出唯一冠军。
  app.post('/api/royale', (req, res) => {
    const body = req.body || {};
    const all = store.listFighters();
    if (all.length < 2) {
      return res.status(400).json({ error: '至少需要抽取 2 个小人才能同台对撞' });
    }
    const size = Math.min(all.length, Math.min(70, Math.max(2, Number(body.size) || all.length)));
    const seed = Number.isFinite(Number(body.seed)) ? Number(body.seed) : Date.now() % 100000;
    const roster = all.slice(0, size);

    const result = simulateRoyale(roster, { seed });
    for (const outcome of royaleOutcomes(result)) store.applyOutcome(outcome);

    res.json({ result, size: roster.length, leaderboard: store.leaderboard() });
  });

  app.post('/api/reset', (_req, res) => {
    res.json(store.reset());
  });

  app.use(express.static(PUBLIC_DIR));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  const app = createApp();
  app.listen(port, () => {
    console.log(`🥊 Seed Brawlers 3D 已启动: http://localhost:${port}`);
  });
}
