import { createRng, randRange, clamp } from './rng.js';

const MAX_ROUNDS = 24;

function initiative(a, b, rng) {
  const sa = a.derived ? a.derived : a;
  const sb = b.derived ? b.derived : b;
  const rollA = a.stats.speed + randRange(rng, -8, 8);
  const rollB = b.stats.speed + randRange(rng, -8, 8);
  return rollA >= rollB ? [a, b] : [b, a];
}

function computeHit(attacker, defender, momentum, rng) {
  const acc = 0.62 + attacker.stats.technique / 260 + attacker.stats.speed / 400 + momentum * 0.05;
  const eva = defender.stats.speed / 380 + defender.stats.technique / 520;
  return clamp(acc - eva, 0.18, 0.95) > rng();
}

function computeDamage(attacker, defender, momentum, rng, crit) {
  const raw = attacker.derived.attack * (1 + momentum * 0.08) * randRange(rng, 0.85, 1.18);
  const mitigation = defender.derived.defense * randRange(rng, 0.6, 1.0);
  let dmg = raw - mitigation;
  if (crit) dmg *= attacker.derived.critMult;
  return Math.max(1, Math.round(dmg));
}

function hpRatio(f) {
  return f.hp / f.derived.maxHp;
}

// 单次对撞：两名小人向彼此冲锋，交替交手，直到一方倒下或回合耗尽。
export function simulateBattle(rawA, rawB, { seed = 0 } = {}) {
  const rng = createRng('battle', rawA.number, rawB.number, seed);

  const A = { ...rawA, hp: rawA.derived.maxHp, momentum: 0 };
  const B = { ...rawB, hp: rawB.derived.maxHp, momentum: 0 };

  const events = [];
  let round = 0;
  let winner = null;
  let method = null;

  while (round < MAX_ROUNDS && A.hp > 0 && B.hp > 0) {
    round += 1;
    const [first, second] = initiative(A, B, rng);
    const pair = [
      [first, second],
      [second, first],
    ];

    for (const [atk, def] of pair) {
      if (A.hp <= 0 || B.hp <= 0) break;

      const momentum = atk.momentum;
      const hit = computeHit(atk, def, momentum, rng);

      if (!hit) {
        atk.momentum = clamp(atk.momentum - 1, -3, 6);
        events.push({
          round,
          type: 'miss',
          actor: atk.id,
          target: def.id,
          damage: 0,
          description: `${atk.name} 冲刺落空，${def.name} 侧身闪避。`,
          hp: { [A.id]: A.hp, [B.id]: B.hp },
        });
        continue;
      }

      const crit = rng() < atk.derived.critChance;
      // 撞在一起时的冲击：速度差带来额外动量。
      const speedEdge = (atk.stats.speed - def.stats.speed) / 300;
      const damage = computeDamage(atk, def, momentum + speedEdge, rng, crit);
      def.hp = Math.max(0, def.hp - damage);

      atk.momentum = clamp(atk.momentum + (crit ? 2 : 1), -3, 6);
      def.momentum = clamp(def.momentum - 1, -3, 6);

      // 被击退时，技击高的一方有概率反击。
      let counter = null;
      const counterChance = clamp(0.12 + def.stats.technique / 420 - atk.stats.speed / 500, 0.05, 0.55);
      if (def.hp > 0 && rng() < counterChance) {
        const cCrit = rng() < def.derived.critChance;
        const cDamage = computeDamage(def, atk, 0, rng, cCrit);
        atk.hp = Math.max(0, atk.hp - cDamage);
        counter = {
          actor: def.id,
          target: atk.id,
          damage: cDamage,
          crit: cCrit,
          description: `${def.name} 借力反击，命中 ${atk.name}。`,
        };
      }

      events.push({
        round,
        type: crit ? 'critical' : 'hit',
        actor: atk.id,
        target: def.id,
        damage,
        crit,
        counter,
        description: `${atk.name} ${crit ? '轰出重击' : '撞穿'} ${def.name}，造成 ${damage} 点伤害。`,
        hp: { [A.id]: A.hp, [B.id]: B.hp },
      });
    }

    if (A.hp <= 0 || B.hp <= 0) break;
  }

  if (A.hp <= 0 && B.hp <= 0) {
    winner = null;
    method = 'double-ko';
  } else if (B.hp <= 0) {
    winner = A.id;
    method = 'ko';
  } else if (A.hp <= 0) {
    winner = B.id;
    method = 'ko';
  } else {
    // 回合耗尽，按剩余血量比例判定。
    const ra = hpRatio(A);
    const rb = hpRatio(B);
    if (Math.abs(ra - rb) < 0.05) {
      winner = null;
      method = 'draw';
    } else {
      winner = ra > rb ? A.id : B.id;
      method = 'decision';
    }
  }

  const scoreA = Math.max(0, A.hp);
  const scoreB = Math.max(0, B.hp);
  const mvp =
    method === 'decision' && winner === A.id
      ? B.id
      : method === 'decision' && winner === B.id
        ? A.id
        : winner;

  return {
    id: `B-${rawA.number}-${rawB.number}-${seed}`,
    fighters: [rawA.id, rawB.id],
    winner,
    loser: winner === A.id ? B.id : winner === B.id ? A.id : null,
    method,
    rounds: round,
    maxRounds: MAX_ROUNDS,
    finalHp: { [A.id]: A.hp, [B.id]: B.hp },
    finalHpRatio: { [A.id]: +hpRatio(A).toFixed(3), [B.id]: +hpRatio(B).toFixed(3) },
    damage: { [A.id]: rawA.derived.maxHp - A.hp, [B.id]: rawB.derived.maxHp - B.hp },
    scoreA,
    scoreB,
    mvp,
    events,
    createdAt: new Date().toISOString(),
  };
}

// 多局系列赛：返回总比分，用于更公平地评判“谁更强”。
export function simulateSeries(rawA, rawB, { bestOf = 5, seed = 0 } = {}) {
  const needed = Math.floor(bestOf / 2) + 1;
  let winsA = 0;
  let winsB = 0;
  const games = [];
  for (let i = 0; i < bestOf; i++) {
    const result = simulateBattle(rawA, rawB, { seed: seed + i });
    games.push(result);
    if (result.winner === rawA.id) winsA += 1;
    else if (result.winner === rawB.id) winsB += 1;
    if (winsA >= needed || winsB >= needed) break;
  }
  return {
    bestOf,
    winsA,
    winsB,
    games,
    champion: winsA > winsB ? rawA.id : winsB > winsA ? rawB.id : null,
  };
}
