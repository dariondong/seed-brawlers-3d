import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareFighters } from './fighters.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const MAX_HISTORY = 40;

function emptyState() {
  return { fighters: [], battles: [], nextNumber: 1, updatedAt: null };
}

export class Store {
  constructor({ file = STATE_FILE, persist = true } = {}) {
    this.file = file;
    this.persistEnabled = persist;
    this.state = this.#load();
    this._flushTimer = null;
  }

  #load() {
    if (!this.persistEnabled) return emptyState();
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        fighters: Array.isArray(parsed.fighters) ? parsed.fighters : [],
        battles: Array.isArray(parsed.battles) ? parsed.battles : [],
        nextNumber: Number.isInteger(parsed.nextNumber) ? parsed.nextNumber : 1,
        updatedAt: parsed.updatedAt || null,
      };
    } catch {
      return emptyState();
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
    return this.state.fighters.find((f) => f.number === Number(number));
  }

  addFighter(fighter) {
    if (this.getFighter(fighter.number)) return this.getFighter(fighter.number);
    this.state.fighters.push(fighter);
    if (fighter.number >= this.state.nextNumber) {
      this.state.nextNumber = fighter.number + 1;
    }
    this.#flush();
    return fighter;
  }

  // 自定义名单用：号码已存在则覆盖姓名（保留战绩），否则新增。
  upsertFighter(fighter) {
    const existing = this.getFighter(fighter.number);
    if (existing) {
      existing.name = fighter.name;
      existing.custom = fighter.custom;
      this.#flush();
      return existing;
    }
    return this.addFighter(fighter);
  }

  renameFighter(number, name) {
    const f = this.getFighter(number);
    if (!f) return null;
    f.name = String(name).trim().slice(0, 24);
    f.custom = true;
    this.#flush();
    return f;
  }

  takeNextNumber() {
    const n = this.state.nextNumber;
    this.state.nextNumber = n + 1;
    this.#flush();
    return n;
  }

  recordBattle(result) {
    this.state.battles.unshift(result);
    if (this.state.battles.length > MAX_HISTORY) {
      this.state.battles.length = MAX_HISTORY;
    }
    this.#flush();
    return result;
  }

  applyOutcome(result) {
    const a = this.state.fighters.find((f) => f.id === result.fighters[0]);
    const b = this.state.fighters.find((f) => f.id === result.fighters[1]);
    if (!a || !b) return;
    if (!result.winner) {
      a.draws += 1;
      b.draws += 1;
    } else if (result.winner === a.id) {
      a.wins += 1;
      b.losses += 1;
    } else {
      b.wins += 1;
      a.losses += 1;
    }
    this.#flush();
  }

  leaderboard() {
    return [...this.state.fighters]
      .map((f) => {
        const total = f.wins + f.losses;
        return {
          ...f,
          total,
          winRate: total > 0 ? +(f.wins / total).toFixed(4) : null,
        };
      })
      .sort(compareFighters);
  }

  recentBattles(limit = 10) {
    return this.state.battles.slice(0, limit);
  }

  snapshot() {
    return {
      fighters: this.listFighters(),
      leaderboard: this.leaderboard(),
      battles: this.recentBattles(),
      nextNumber: this.state.nextNumber,
      updatedAt: this.state.updatedAt,
    };
  }

  reset() {
    this.state = emptyState();
    this.flushNow();
    return this.snapshot();
  }
}
