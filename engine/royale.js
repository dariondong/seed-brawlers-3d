import { createRng } from './rng.js';
import { simulateBattle } from './battle.js';

// 用种子做确定性洗牌（Fisher-Yates），保证同一个 seed 下 70 人站位与对阵稳定可复现。
export function seededShuffle(arr, seed) {
  const rng = createRng('royale-shuffle', seed);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function tiebreak(a, b) {
  if (a.power !== b.power) return a.power > b.power ? a : b;
  return a.number <= b.number ? a : b;
}

// 大乱斗：所有人同台，逐轮两两对撞，败者淘汰，胜者进入下一轮，直到决出唯一冠军。
// 每轮内所有对局同时进行（便于前端一次性动画展示）。
export function simulateRoyale(fighters, { seed = 0, maxSize = 100 } = {}) {
  if (fighters.length < 2) {
    throw new Error('大乱斗至少需要 2 个小人');
  }

  const roster = seededShuffle(fighters.slice(0, maxSize), seed);
  let alive = roster;
  const rounds = [];
  let roundNo = 0;

  while (alive.length > 1 && roundNo < 32) {
    roundNo += 1;
    const fights = [];
    const winners = [];
    let bye = null;

    const pairCount = Math.floor(alive.length / 2);
    for (let i = 0; i < pairCount; i++) {
      const a = alive[i * 2];
      const b = alive[i * 2 + 1];
      const result = simulateBattle(a, b, { seed: seed + roundNo * 100000 + i });

      let winner = result.winner ? (result.winner === a.id ? a : b) : tiebreak(a, b);
      const loser = winner.id === a.id ? b : a;

      fights.push({
        a: a.id,
        b: b.id,
        aName: a.name,
        bName: b.name,
        winner: winner.id,
        loser: loser.id,
        winnerName: winner.name,
        loserName: loser.name,
        method: result.method,
        rounds: result.rounds,
        damage: result.damage,
      });
      winners.push(winner);
    }

    if (alive.length % 2 === 1) {
      bye = alive[alive.length - 1];
      winners.push(bye);
    }

    rounds.push({
      round: roundNo,
      fights,
      bye: bye ? { id: bye.id, name: bye.name } : null,
      survivors: winners.map((w) => ({ id: w.id, name: w.name })),
      eliminated: fights.map((f) => ({ id: f.loser, name: f.loserName })),
    });

    alive = winners;
  }

  return {
    id: `R-${seed}-${roster.length}`,
    mode: 'royale',
    seed,
    size: roster.length,
    rounds,
    totalFights: rounds.reduce((n, r) => n + r.fights.length, 0),
    champion: alive[0] ? { id: alive[0].id, name: alive[0].name, number: alive[0].number } : null,
    createdAt: new Date().toISOString(),
  };
}

// 把大乱斗中每一场对局的结果写回战绩（用于胜率排行榜）。
export function royaleOutcomes(royale) {
  const out = [];
  for (const round of royale.rounds) {
    for (const f of round.fights) {
      out.push({ fighters: [f.a, f.b], winner: f.winner });
    }
  }
  return out;
}
