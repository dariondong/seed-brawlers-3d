import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import * as core from '../engine/state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

// 把领域错误映射为 HTTP 状态：未抽到的号码 → 404，其余 → 400。
const fail = (res, err) => res.status(/尚未抽取/.test(err.message) ? 404 : 400).json({ error: err.message });

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
    try {
      const out = core.draw(store.state, (req.body || {}).number);
      store.flushNow();
      res.status(out.created ? 201 : 200).json(out);
    } catch (err) {
      fail(res, err);
    }
  });

  // 一次抽取多个号码（最多 70 名，用于同台大乱斗）。
  app.post('/api/draw/batch', (req, res) => {
    const out = core.drawBatch(store.state, (req.body || {}).count);
    store.flushNow();
    res.status(201).json(out);
  });

  // 对撞搏斗：可传入双方号码，未指定则自动挑选两名小人。
  app.post('/api/battle', (req, res) => {
    try {
      const out = core.battle(store.state, req.body || {});
      store.flushNow();
      res.json(out);
    } catch (err) {
      fail(res, err);
    }
  });

  app.get('/api/leaderboard', (_req, res) => {
    res.json({ leaderboard: store.leaderboard() });
  });

  // 自定义名单：粘贴一批名字（或 {"names":[...]} / {"text":"每行一个"}）。
  app.post('/api/roster', (req, res) => {
    try {
      const out = core.setRoster(store.state, req.body || {});
      store.flushNow();
      res.status(201).json(out);
    } catch (err) {
      fail(res, err);
    }
  });

  // 改名：自定义名单里点名字即可改。
  app.post('/api/roster/rename', (req, res) => {
    try {
      const { number, name } = req.body || {};
      const out = core.rename(store.state, number, name);
      store.flushNow();
      res.json(out);
    } catch (err) {
      fail(res, err);
    }
  });

  // 大乱斗：所有（或指定数量）小人同台，逐轮两两对撞淘汰，决出唯一冠军。
  app.post('/api/royale', (req, res) => {
    try {
      const out = core.royale(store.state, req.body || {});
      store.flushNow();
      res.json(out);
    } catch (err) {
      fail(res, err);
    }
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
