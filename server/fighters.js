import { createRng, randRange, randInt, pick, clamp } from './rng.js';

// 派系模板：weights 用来塑造属性分布，数值越大该属性越突出。
export const ARCHETYPES = [
  { id: 'berserker', label: '狂战士', glyph: '⚔️', weights: { power: 1.5, speed: 0.9, toughness: 1.1, technique: 0.7 } },
  { id: 'duelist', label: '剑术家', glyph: '🤺', weights: { power: 0.9, speed: 1.3, toughness: 0.8, technique: 1.4 } },
  { id: 'juggernaut', label: '重装武者', glyph: '🛡️', weights: { power: 1.2, speed: 0.6, toughness: 1.6, technique: 0.8 } },
  { id: 'monk', label: '拳宗', glyph: '👊', weights: { power: 1.1, speed: 1.1, toughness: 1.0, technique: 1.1 } },
  { id: 'assassin', label: '影刺', glyph: '🗡️', weights: { power: 1.0, speed: 1.5, toughness: 0.7, technique: 1.2 } },
  { id: 'wrestler', label: '搏克手', glyph: '🤼', weights: { power: 1.3, speed: 0.9, toughness: 1.3, technique: 1.0 } },
];

export const ARCHETYPE_BY_ID = Object.fromEntries(ARCHETYPES.map((a) => [a.id, a]));

// 五行元素：决定小人的主体配色。
export const ELEMENTS = [
  { id: 'fire', label: '火', color: '#ff5a3c', glow: '#ffb347' },
  { id: 'ice', label: '冰', color: '#4fc3f7', glow: '#b3e5fc' },
  { id: 'thunder', label: '雷', color: '#ffd54f', glow: '#fff59d' },
  { id: 'shadow', label: '暗', color: '#8e6bff', glow: '#c7b3ff' },
  { id: 'steel', label: '钢', color: '#9fb3c8', glow: '#e3ecf5' },
  { id: 'venom', label: '毒', color: '#4dd07a', glow: '#b7f5c9' },
];

const NAME_PREFIX = ['雷', '炎', '霜', '铁', '疾', '玄', '赤', '幽', '裂', '苍', '刚', '影'];
const NAME_SUFFIX = ['虎', '狼', '鹰', '熊', '蛟', '猿', '豹', '犀', '鹤', '獬', '狮', '鲨'];
const EPITHETS = ['疾风', '不灭', '铁壁', '狂澜', '裂空', '玄霜', '赤炎', '幽影', '天罡', '地煞', '崩山', '断岳'];

function statScore(rng, weight) {
  const base = randRange(rng, 32, 86);
  const adjusted = base + (weight - 1) * 16;
  return clamp(Math.round(adjusted), 8, 99);
}

function buildName(rng) {
  const epithet = pick(rng, EPITHETS);
  const body = `${pick(rng, NAME_PREFIX)}${pick(rng, NAME_SUFFIX)}`;
  return `${epithet}·${body}`;
}

// 由号码确定性地生成一个小人。同一号码 → 同一个小人（外观 / 属性 / 姓名完全一致）。
// opts.name：自定义名单时用真实姓名覆盖随机姓名，属性仍由号码决定。
export function createFighterFromNumber(number, { createdAt, name } = {}) {
  const n = Number(number);
  const rng = createRng('fighter', n);

  const archetype = pick(rng, ARCHETYPES);
  const element = pick(rng, ELEMENTS);

  const stats = {
    power: statScore(rng, archetype.weights.power),
    speed: statScore(rng, archetype.weights.speed),
    toughness: statScore(rng, archetype.weights.toughness),
    technique: statScore(rng, archetype.weights.technique),
  };

  const derived = {
    maxHp: Math.round(90 + stats.toughness * 2.6),
    attack: Math.round(9 + stats.power * 0.55 + stats.technique * 0.28),
    defense: Math.round(3 + stats.toughness * 0.32 + stats.speed * 0.12),
    critChance: clamp(0.03 + stats.technique / 900, 0.03, 0.32),
    critMult: 1.5 + stats.power / 400,
  };

  // 体型参数，前端据此搭建 3D 小人比例。
  const body = {
    height: +randRange(rng, 0.92, 1.22).toFixed(3),
    bulk: +randRange(rng, 0.85, 1.4).toFixed(3),
    shoulder: +randRange(rng, 0.9, 1.35).toFixed(3),
    armLength: +randRange(rng, 0.9, 1.2).toFixed(3),
    legLength: +randRange(rng, 0.9, 1.2).toFixed(3),
    headSize: +randRange(rng, 0.9, 1.15).toFixed(3),
  };

  const power = Math.round(
    stats.power * 1.15 +
      stats.speed * 1.0 +
      stats.toughness * 1.2 +
      stats.technique * 1.05 +
      derived.attack * 1.5 +
      derived.defense * 1.2 +
      derived.maxHp * 0.35,
  );

  return {
    id: `F${n}`,
    number: n,
    name: name && String(name).trim() ? String(name).trim().slice(0, 24) : buildName(rng),
    custom: Boolean(name && String(name).trim()),
    archetype: archetype.id,
    archetypeLabel: archetype.label,
    glyph: archetype.glyph,
    element: element.id,
    elementLabel: element.label,
    color: element.color,
    glow: element.glow,
    stats,
    derived,
    body,
    power,
    wins: 0,
    losses: 0,
    draws: 0,
    createdAt: createdAt || new Date().toISOString(),
  };
}

// 排行榜排序：胜率优先，其次胜场数、战力。
export function compareFighters(a, b) {
  const ra = a.wins + a.losses > 0 ? a.wins / (a.wins + a.losses) : -1;
  const rb = b.wins + b.losses > 0 ? b.wins / (b.wins + b.losses) : -1;
  if (rb !== ra) return rb - ra;
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (b.power !== a.power) return b.power - a.power;
  return a.number - b.number;
}
