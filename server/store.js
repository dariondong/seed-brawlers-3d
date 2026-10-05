import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../engine/state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// Node 端的持久化外壳：状态逻辑全部来自 engine/state.js，这里只负责读写 JSON 文件。
export class Store {
  constructor({ file = STATE_FILE, persist = true } = {}) {
    this.file = file;
    this.persistEnabled = persist;
    this.state = core.createState(this.#load());
    this._flushTimer = null;
  }

  #load() {
    if (!this.persistEnabled) return {};
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  #flush() {
    if (!this.persistEnabled) return;
    clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => this.flushNow(), 150);
  }

  flushNow() {
    if (!this.persistEnabled) return;
    this.state.updatedAt = new Date().toISOString();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }

  listFighters() {
    return this.state.fighters;
  }

  getFighter(number) {
    return core.getFighter(this.state, number);
  }

  addFighter(fighter) {
    const f = core.addFighter(this.state, fighter);
    this.#flush();
    return f;
  }

  upsertFighter(fighter) {
    const f = core.upsertFighter(this.state, fighter);
    this.#flush();
    return f;
  }

  renameFighter(number, name) {
    const f = core.renameFighter(this.state, number, name);
    this.#flush();
    return f;
  }

  takeNextNumber() {
    const n = core.takeNextNumber(this.state);
    this.#flush();
    return n;
  }

  recordBattle(result) {
    const r = core.recordBattle(this.state, result);
    this.#flush();
    return r;
  }

  applyOutcome(result) {
    core.applyOutcome(this.state, result);
    this.#flush();
  }

  leaderboard() {
    return core.leaderboard(this.state);
  }

  recentBattles(limit = 10) {
    return this.state.battles.slice(0, limit);
  }

  snapshot() {
    return core.snapshot(this.state);
  }

  reset() {
    const snap = core.reset(this.state);
    this.flushNow();
    return snap;
  }
}
