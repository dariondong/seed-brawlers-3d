// 与运行环境无关的状态逻辑：Node 服务端与浏览器（GitHub Pages 静态部署）共用。
import { compareFighters, createFighterFromNumber } from './fighters.js';
import { simulateBattle, simulateSeries } from './battle.js';
import { simulateRoyale, royaleOutcomes } from './royale.js';

export const MAX_ROSTER = 70;
const MAX_HISTORY = 40;

export function emptyState() {
  return { fighters: [], battles: [], nextNumber: 1, updatedAt: null };
}

// 生成一个只含数据的状态对象（不涉及持久化）。
export function createState(seed = {}) {
  const state = {
    ...emptyState(),
    fighters: Array.isArray(seed.fighters) ? seed.fighters : [],
    battles: Array.isArray(seed.battles) ? seed.battles : [],
    nextNumber: Number.isInteger(seed.nextNumber) ? seed.nextNumber : 1,
    updatedAt: seed.updatedAt || null,
  };
  return state;
}

const findById = (state, id) => state.fighters.find((f) => f.id === id);
const findByNumber = (state, number) => state.fighters.find((f) => f.number === Number(number));

export function getFighter(state, number) {
  return findByNumber(state, number);
}

export function addFighter(state, fighter) {
  const existing = findByNumber(state, fighter.number);
  if (existing) return existing;
  state.fighters.push(fighter);
  if (fighter.number >= state.nextNumber) state.nextNumber = fighter.number + 1;
  return fighter;
}

// 号码已存在则覆盖姓名（保留战绩），否则新增。
export function upsertFighter(state, fighter) {
  const existing = findByNumber(state, fighter.number);
  if (existing) {
    existing.name = fighter.name;
    existing.custom = fighter.custom;
    return existing;
  }
  return addFighter(state, fighter);
}

export function renameFighter(state, number, name) {
  const f = findByNumber(state, number);
  if (!f) return null;
  f.name = String(name).trim().slice(0, 24);
  f.custom = true;
  return f;
}

export function takeNextNumber(state) {
  const n = state.nextNumber;
  state.nextNumber = n + 1;
  return n;
}

export function recordBattle(state, result) {
  state.battles.unshift(result);
  if (state.battles.length > MAX_HISTORY) state.battles.length = MAX_HISTORY;
  return result;
}

export function applyOutcome(state, result) {
  const a = findById(state, result.fighters[0]);
  const b = findById(state, result.fighters[1]);
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
}

export function leaderboard(state) {
  return [...state.fighters]
    .map((f) => {
      const total = f.wins + f.losses;
      return { ...f, total, winRate: total > 0 ? +(f.wins / total).toFixed(4) : null };
    })
    .sort(compareFighters);
}

export function snapshot(state) {
  return {
    fighters: state.fighters,
    leaderboard: leaderboard(state),
    battles: state.battles.slice(0, 10),
    nextNumber: state.nextNumber,
    updatedAt: state.updatedAt,
  };
}

// ---------- 业务操作（对应原有 HTTP 接口的语义） ----------

export function draw(state, number) {
  let n = number;
  if (n === undefined || n === null || n === '') {
    n = takeNextNumber(state);
  } else {
    n = Number(n);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) {
      throw new Error('号码必须是 0 到 1e9 之间的数字');
    }
  }
  const existing = getFighter(state, n);
  const fighter = existing || addFighter(state, createFighterFromNumber(n));
  return { created: !existing, fighter };
}

export function drawBatch(state, count) {
  const n = Math.min(MAX_ROSTER, Math.max(1, Number(count) || 2));
  const created = [];
  for (let i = 0; i < n; i++) {
    const number = takeNextNumber(state);
    created.push(getFighter(state, number) || addFighter(state, createFighterFromNumber(number)));
  }
  return { fighters: created };
}

export function battle(state, payload = {}) {
  const { a: aNo, b: bNo, bestOf: rawBestOf, seed } = payload;
  let a = aNo !== undefined ? getFighter(state, aNo) : null;
  let b = bNo !== undefined ? getFighter(state, bNo) : null;

  if (aNo !== undefined && !a) throw new Error(`号码 ${aNo} 尚未抽取`);
  if (bNo !== undefined && !b) throw new Error(`号码 ${bNo} 尚未抽取`);

  if (!a && !b) {
    if (state.fighters.length < 2) throw new Error('至少需要抽取 2 个小人才能对撞');
    const shuffled = [...state.fighters].sort(() => Math.random() - 0.5);
    a = shuffled[0];
    b = shuffled[1];
  } else if (!a) {
    a = state.fighters.find((f) => f.id !== b.id);
  } else if (!b) {
    b = state.fighters.find((f) => f.id !== a.id);
  }
  if (!a || !b || a.id === b.id) throw new Error('无法选定两个不同的小人');

  const bestOf = Math.min(9, Math.max(1, Number(rawBestOf) || 1));
  const result =
    bestOf > 1
      ? simulateSeries(a, b, { bestOf, seed: seed || 0 })
      : simulateBattle(a, b, { seed: seed || 0 });

  const record = bestOf > 1 ? result.games[result.games.length - 1] : result;
  recordBattle(state, record);
  if (bestOf > 1) {
    for (const game of result.games) applyOutcome(state, game);
  } else {
    applyOutcome(state, record);
  }

  return { result, bestOf, leaderboard: leaderboard(state) };
}

export function royale(state, payload = {}) {
  const all = state.fighters;
  if (all.length < 2) throw new Error('至少需要抽取 2 个小人才能同台对撞');
  const size = Math.min(all.length, Math.min(MAX_ROSTER, Math.max(2, Number(payload.size) || all.length)));
  const seed = Number.isFinite(Number(payload.seed)) ? Number(payload.seed) : Date.now() % 100000;
  const roster = all.slice(0, size);

  const result = simulateRoyale(roster, { seed });
  for (const outcome of royaleOutcomes(result)) applyOutcome(state, outcome);

  return { result, size: roster.length, leaderboard: leaderboard(state) };
}

export function parseRosterNames(body = {}) {
  let names = [];
  if (Array.isArray(body.names)) {
    names = body.names.map((s) => String(s).trim()).filter(Boolean);
  } else if (typeof body.text === 'string') {
    names = body.text
      .split(/[\n,，、;；]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return names.slice(0, MAX_ROSTER).map((s) => s.slice(0, 24));
}

export function setRoster(state, body = {}) {
  const names = parseRosterNames(body);
  if (!names.length) throw new Error('名单为空，请输入至少一个姓名');

  const startNo = Number.isInteger(body.startNumber) && body.startNumber >= 0 ? body.startNumber : state.nextNumber;
  const mode = body.mode === 'replace' ? 'replace' : 'append';
  if (mode === 'replace') {
    const fresh = emptyState();
    state.fighters = fresh.fighters;
    state.battles = fresh.battles;
    state.nextNumber = fresh.nextNumber;
  }
  const base = mode === 'replace' ? 1 : startNo;

  const fighters = [];
  names.forEach((name, i) => {
    const number = base + i;
    fighters.push(upsertFighter(state, createFighterFromNumber(number, { name })));
    if (number >= state.nextNumber) state.nextNumber = number + 1;
  });

  return { mode, count: fighters.length, fighters, leaderboard: leaderboard(state) };
}

export function rename(state, number, name) {
  if (number === undefined || !name) throw new Error('需要提供 number 与 name');
  const updated = renameFighter(state, number, name);
  if (!updated) throw new Error(`号码 ${number} 尚未抽取`);
  return { fighter: updated };
}

export function reset(state) {
  const fresh = emptyState();
  state.fighters = fresh.fighters;
  state.battles = fresh.battles;
  state.nextNumber = fresh.nextNumber;
  state.updatedAt = null;
  return snapshot(state);
}
