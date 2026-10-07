import { createRng, clamp } from './rng.js';

// 同台大乱斗（真·混战）：
// 所有小人同时进场，各自冲向最近的对手；身体一旦接触就互相输出伤害，
// 血量归零即倒地，站到最后的唯一一人夺冠。
// 不再是「两两配对、逐轮淘汰」的回合制赛制。
//
// 引擎与画面共用同一套模拟：createMelee() 暴露逐步推进的 stepper，
// 前端按真实帧率 step()，所以屏幕上看到的走位与结果完全一致。

export const MAX_MELEE = 70;

export const DT = 0.1; // 模拟步长（秒）
export const CONTACT = 0.62; // 身体接触判定半径
const MAX_TICKS = 2600; // 约 26s 上限，保证一定收敛
const ARENA_RADIUS = 9.2;
const COOLDOWN = 0.34; // 同一名小人两次交手的间隔

// 用种子做确定性洗牌（Fisher-Yates）：同一 seed 下出场顺序稳定可复现。
export function seededShuffle(arr, seed) {
  const rng = createRng('melee-shuffle', seed);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 出生点：2 人左右对立，多人黄金角螺旋铺满圆形场地。
export function spawnPositions(count) {
  if (count <= 1) return [{ x: 0, z: 0, ry: 0 }];
  if (count === 2) {
    return [
      { x: -1.7, z: 0, ry: Math.PI / 2 },
      { x: 1.7, z: 0, ry: -Math.PI / 2 },
    ];
  }
  const radius = Math.max(3.2, 0.95 * Math.sqrt(count));
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out = [];
  for (let i = 0; i < count; i++) {
    const r = radius * Math.sqrt((i + 0.4) / count);
    const th = i * golden;
    const x = Math.cos(th) * r;
    const z = Math.sin(th) * r;
    out.push({ x, z, ry: Math.atan2(-x, -z) });
  }
  return out;
}

// 战力 → 相对强度：同时决定伤害与体重（体重决定对撞时谁占上风）。
function strength(fighter) {
  return clamp((Number(fighter.power) || 300) / 430, 0.55, 1.9);
}

// 接触着的两人交手一回合：占上风者压着对方打，取巧者仍有概率反杀。
// 只有血量归零才算倒地，一次接触最多淘汰一人。
function exchange(dom, sub, rng) {
  sub.hp -= dom.atk * (0.55 + 0.45 * rng());
  dom.hp -= sub.atk * (0.18 + 0.22 * rng());

  if (sub.hp <= 0) {
    sub.hp = 0;
    sub.alive = false;
    dom.kills += 1;
    return { fallen: sub, survivor: dom };
  }
  return null;
}

// 逐步推进的混战模拟器（引擎与画面共用）。
export function createMelee(fighters, { seed = 0, maxSize = MAX_MELEE, maxTicks = MAX_TICKS } = {}) {
  if (fighters.length < 2) throw new Error('大乱斗至少需要 2 个小人');

  const roster = seededShuffle(fighters.slice(0, maxSize), seed);
  const spawn = spawnPositions(roster.length);
  const rng = createRng('melee', seed, roster.length);

  const units = roster.map((f, i) => ({
    id: f.id,
    fighter: f,
    x: spawn[i].x,
    z: spawn[i].z,
    ry: spawn[i].ry,
    alive: true,
    hp: f.derived.maxHp,
    atk: f.derived.attack,
    spd: 1.55 + (f.stats.speed / 100) * 1.15,
    w: strength(f),
    cd: 0,
    kills: 0,
  }));

  let tick = 0;
  let alive = units.length;
  let events = [];

  const isDone = () => alive <= 1 || tick >= maxTicks;

  function step() {
    if (isDone()) return [];
    tick += 1;
    const koEvents = [];
    const contact = [];

    // 1) 各自冲向最近的对手
    for (const u of units) {
      if (!u.alive) continue;
      u.cd = Math.max(0, u.cd - DT);

      let best = null;
      let bestD = Infinity;
      for (const v of units) {
        if (v === u || !v.alive) continue;
        const dx = v.x - u.x;
        const dz = v.z - u.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD) {
          bestD = d2;
          best = v;
        }
      }
      if (!best) continue;

      const d = Math.sqrt(bestD) || 1;
      const stepLen = Math.min(u.spd * DT, d);
      u.x += ((best.x - u.x) / d) * stepLen;
      u.z += ((best.z - u.z) / d) * stepLen;
      u.ry = Math.atan2(best.x - u.x, best.z - u.z);

      const fromCenter = Math.hypot(u.x, u.z);
      if (fromCenter > ARENA_RADIUS) {
        u.x = (u.x / fromCenter) * ARENA_RADIUS;
        u.z = (u.z / fromCenter) * ARENA_RADIUS;
      }
    }

    // 2) 接触即交手
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!u.alive) continue;
      for (let j = i + 1; j < units.length; j++) {
        const v = units[j];
        if (!v.alive || u.cd > 0 || v.cd > 0) continue;

        const dx = v.x - u.x;
        const dz = v.z - u.z;
        const d = Math.hypot(dx, dz);
        if (d > CONTACT) continue;

        // 轻微弹开，避免叠在一起
        const push = (CONTACT - d) / 2 + 0.004;
        const nx = dx / (d || 1);
        const nz = dz / (d || 1);
        u.x -= nx * push;
        u.z -= nz * push;
        v.x += nx * push;
        v.z += nz * push;

        const dom = rng() < u.w / (u.w + v.w) ? u : v;
        const sub = dom === u ? v : u;
        u.cd = v.cd = COOLDOWN * (0.7 + rng() * 0.6);

        const ko = exchange(dom, sub, rng);
        const at = {
          t: +(tick * DT).toFixed(2),
          x: (u.x + v.x) / 2,
          z: (u.z + v.z) / 2,
          actor: dom.id,
          target: sub.id,
          actorName: dom.fighter.name,
          targetName: sub.fighter.name,
          remaining: alive,
        };
        if (ko) {
          alive -= 1;
          const ev = {
            ...at,
            type: 'ko',
            winner: ko.survivor.id,
            loser: ko.fallen.id,
            winnerName: ko.survivor.fighter.name,
            loserName: ko.fallen.fighter.name,
          };
          ev.remaining = alive;
          koEvents.push(ev);
          contact.push(ev);
        } else {
          contact.push({ ...at, type: 'hit' });
        }
      }
    }

    events = events.concat(koEvents);
    return contact;
  }

  function finish() {
    // 安全网：极端情况下全场同归于尽，让战力最强者以 1 血站到最后。
    if (alive === 0) {
      let best = units[0];
      for (const u of units) if (u.w > best.w) best = u;
      best.alive = true;
      best.hp = 1;
      alive = 1;
    }

    const champion = units.find((u) => u.alive) || units[0];

    // 名次：冠军第 1，其余按「存活时长 → 剩余血量 → 战力」排序。
    const koAt = new Map();
    for (const e of events) koAt.set(e.loser, e.t);
    const others = units
      .filter((u) => u !== champion)
      .sort((a, b) => {
        const ta = koAt.get(a.id) ?? Infinity;
        const tb = koAt.get(b.id) ?? Infinity;
        if (tb !== ta) return tb - ta;
        if (b.hp !== a.hp) return b.hp - a.hp;
        return b.w - a.w;
      });

    const standings = [
      { id: champion.id, name: champion.fighter.name, number: champion.fighter.number, rank: 1, kills: champion.kills },
      ...others.map((u, i) => ({
        id: u.id,
        name: u.fighter.name,
        number: u.fighter.number,
        rank: i + 2,
        kills: u.kills,
      })),
    ];

    return {
      id: `M-${seed}-${units.length}`,
      mode: 'melee',
      seed,
      size: units.length,
      duration: +(tick * DT).toFixed(2),
      events,
      standings,
      units: units.map((u) => ({
        id: u.id,
        x: +u.x.toFixed(4),
        z: +u.z.toFixed(4),
        ry: +u.ry.toFixed(4),
        alive: u.alive,
        hp: Math.max(0, Math.round(u.hp)),
      })),
      totalFights: events.length,
      champion: champion
        ? { id: champion.id, name: champion.fighter.name, number: champion.fighter.number }
        : null,
      createdAt: new Date().toISOString(),
    };
  }

  return {
    step,
    finish,
    isDone,
    get tick() {
      return tick;
    },
    get alive() {
      return alive;
    },
    units,
    events: () => events,
  };
}

// 一次性跑完（服务端 / 测试用）。
export function simulateRoyale(fighters, { seed = 0, maxSize = MAX_MELEE, maxTicks = MAX_TICKS } = {}) {
  const melee = createMelee(fighters, { seed, maxSize, maxTicks });
  while (!melee.isDone()) melee.step();
  return melee.finish();
}

// 把混战里每一次「击倒」写回战绩（用于胜率排行榜）。
export function royaleOutcomes(royale) {
  return royale.events.map((e) => ({ fighters: [e.winner, e.loser], winner: e.winner }));
}
