import { Arena } from './scene.js';
import { api } from './api.js';

const $ = (id) => document.getElementById(id);

const els = {
  canvas: $('canvas'),
  roster: $('roster'),
  rosterCount: $('rosterCount'),
  rosterSearch: $('rosterSearch'),
  addNumber: $('addNumber'),
  addBtn: $('addBtn'),
  add70: $('add70'),
  leaderboard: $('leaderboard'),
  log: $('log'),
  numberInput: $('numberInput'),
  drawBtn: $('drawBtn'),
  autoDrawBtn: $('autoDrawBtn'),
  royaleBtn: $('royaleBtn'),
  battleBtn: $('battleBtn'),
  resetBtn: $('resetBtn'),
  bestOf: $('bestOf'),
  status: $('status'),
  slotA: $('slotA'),
  slotB: $('slotB'),
  hpA: $('hpA'),
  hpB: $('hpB'),
  hpTextA: $('hpTextA'),
  hpTextB: $('hpTextB'),
  hpOverlay: $('hpOverlay'),
  roundBadge: $('roundBadge'),
  championBanner: $('championBanner'),
  poolSize: $('poolSize'),
  rosterBtn: $('rosterBtn'),
  rosterModal: $('rosterModal'),
  rosterText: $('rosterText'),
  rosterCountInput: $('rosterCountInput'),
  rosterAppend: $('rosterAppend'),
  rosterReplace: $('rosterReplace'),
  rosterClose: $('rosterClose'),
  sampleBtn: $('sampleBtn'),
};

let leaderboard = [];
let fighters = [];
let byId = new Map();
let selection = { A: null, B: null };
let busy = false;
let filter = '';

const MAX_ROSTER = 70;

const arena = new Arena(els.canvas, {
  onHp: (hp) => {
    if (!selection.A || !selection.B) return;
    renderHp('A', hp[selection.A.id]);
    renderHp('B', hp[selection.B.id]);
  },
  onRound: (info) => {
    els.roundBadge.style.display = 'block';
    els.roundBadge.textContent = `第 ${info.round} / ${info.totalRounds} 轮 · 场上 ${info.fighters} 人`;
    pushLog(`⚔️ 第 ${info.round} 轮开始：${info.fighters} 人同台` + (info.bye ? `（${info.bye.name} 轮空）` : ''), 'info');
  },
  onFight: (f) => {
    pushLog(`${f.winnerName} 淘汰 ${f.loserName}`, 'hit');
  },
  onChampion: (champ) => {
    els.roundBadge.textContent = `冠军：${champ.name}`;
    els.championBanner.style.display = 'flex';
    els.championBanner.innerHTML = `<span>🏆 大乱斗冠军</span><b>#${champ.number} ${champ.name}</b>`;
    pushLog(`🏆 冠军诞生：#${champ.number} ${champ.name}`, 'win');
  },
  onRoyaleEnd: async (result) => {
    els.roundBadge.style.display = 'none';
    await refresh();
    busy = false;
    updateButtons();
  },
  onDuelEvent: (ev) => {
    const name = (id) => byId.get(id)?.name || id;
    if (ev.type === 'miss') pushLog(`${name(ev.actor)} 的冲刺落空，${name(ev.target)} 闪避。`, 'miss');
    else pushLog(`${name(ev.actor)} ${ev.type === 'critical' ? '重击' : '冲撞'} ${name(ev.target)} -${ev.damage}`, ev.type === 'critical' ? 'crit' : 'hit');
    els.hpOverlay.style.display = 'flex';
    renderHp('A', ev.hp[selection.A.id]);
    renderHp('B', ev.hp[selection.B.id]);
  },
  onDuelFinish: async (result) => {
    const name = (id) => byId.get(id)?.name || id;
    if (!result.winner) pushLog('平局！双方都倒下了。', 'draw');
    else pushLog(`🏆 ${name(result.winner)} 获胜！（${result.method}）`, 'win');
    await refresh();
    busy = false;
    updateButtons();
  },
});

function pushLog(text, kind = 'hit') {
  const line = document.createElement('div');
  line.className = `log-line log-${kind}`;
  line.textContent = text;
  els.log.prepend(line);
  while (els.log.children.length > 80) els.log.lastChild.remove();
}

function setStatus(text, kind = '') {
  els.status.textContent = text;
  els.status.className = `status ${kind}`;
}

const fmtPct = (x) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(0)}%`);

function statBar(label, value) {
  return `<div class="stat"><span>${label}</span><div class="bar"><i style="width:${value}%"></i></div><b>${value}</b></div>`;
}

function renderFighterCard(fighter) {
  if (!fighter) return `<div class="card-empty">未选择</div>`;
  return `
    <div class="card-head" style="--accent:${fighter.color}">
      <div class="avatar" style="background:${fighter.color}22;border-color:${fighter.color}">${fighter.glyph}</div>
      <div>
        <div class="card-name">${fighter.name}</div>
        <div class="card-sub">#${fighter.number} · ${fighter.archetypeLabel} · ${fighter.elementLabel}</div>
      </div>
      <div class="power">战力<br><b>${fighter.power}</b></div>
    </div>
    <div class="stats">
      ${statBar('力', fighter.stats.power)}
      ${statBar('速', fighter.stats.speed)}
      ${statBar('韧', fighter.stats.toughness)}
      ${statBar('技', fighter.stats.technique)}
    </div>
    <div class="card-foot">HP ${fighter.derived.maxHp} · 攻 ${fighter.derived.attack} · 防 ${fighter.derived.defense} · 暴击 ${(fighter.derived.critChance * 100).toFixed(0)}%</div>
  `;
}

function renderHp(key, hp) {
  const fighter = selection[key];
  if (!fighter || hp === undefined) return;
  const ratio = Math.max(0, Math.min(1, hp / fighter.derived.maxHp));
  const bar = key === 'A' ? els.hpA : els.hpB;
  const txt = key === 'A' ? els.hpTextA : els.hpTextB;
  bar.style.width = `${ratio * 100}%`;
  bar.style.background = ratio > 0.5 ? '#4dd07a' : ratio > 0.22 ? '#ffd54f' : '#ff5a3c';
  txt.textContent = `${Math.max(0, Math.round(hp))} / ${fighter.derived.maxHp}`;
}

function fullHp() {
  if (selection.A) renderHp('A', selection.A.derived.maxHp);
  if (selection.B) renderHp('B', selection.B.derived.maxHp);
}

function renderSlots() {
  els.slotA.innerHTML = renderFighterCard(selection.A);
  els.slotB.innerHTML = renderFighterCard(selection.B);
  fullHp();
}

function renderRoster() {
  const shown = filter
    ? fighters.filter((f) => f.name.includes(filter) || String(f.number).includes(filter) || f.archetypeLabel.includes(filter))
    : fighters;
  els.rosterCount.textContent = `共 ${fighters.length} / ${MAX_ROSTER} 名`;
  if (!shown.length) {
    els.roster.innerHTML = `<div class="empty">${fighters.length ? '无匹配结果' : '还没有小人，点击「抽号生成」或「自动抽满 70」'}</div>`;
    return;
  }
  els.roster.innerHTML = shown
    .map((f) => {
      const isA = selection.A?.id === f.id;
      const isB = selection.B?.id === f.id;
      return `<button class="chip ${isA ? 'chip-a' : ''} ${isB ? 'chip-b' : ''}" data-id="${f.id}" style="--accent:${f.color}">
        <span class="chip-num">#${f.number}</span>
        <span class="chip-name">${f.name}</span>
        <span class="chip-tag">${f.archetypeLabel}</span>
      </button>`;
    })
    .join('');
}

function renderLeaderboard() {
  if (!leaderboard.length) {
    els.leaderboard.innerHTML = `<div class="empty">暂无数据，先抽取小人并对撞。</div>`;
    return;
  }
  els.leaderboard.innerHTML = leaderboard
    .map((f, i) => {
      const rank = i + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`;
      const rate = f.total > 0 ? f.winRate : null;
      return `<div class="lb-row ${rank <= 3 ? 'lb-top' : ''} ${selection.A?.id === f.id ? 'lb-a' : ''} ${selection.B?.id === f.id ? 'lb-b' : ''}">
        <div class="lb-rank">${medal}</div>
        <div class="lb-main">
          <div class="lb-name" style="color:${f.color}">${f.name}</div>
          <div class="lb-meta">#${f.number} · ${f.archetypeLabel} · 战力 ${f.power}</div>
          <div class="lb-bar"><i style="width:${(rate ?? 0) * 100}%;background:${f.color}"></i></div>
        </div>
        <div class="lb-stats">
          <div class="lb-rate">${fmtPct(rate)}</div>
          <div class="lb-wl">${f.wins}胜 ${f.losses}负${f.draws ? ` ${f.draws}平` : ''}</div>
        </div>
      </div>`;
    })
    .join('');
}

function updateButtons() {
  els.royaleBtn.disabled = fighters.length < 2 || busy;
  els.battleBtn.disabled = fighters.length < 2 || busy;
  els.autoDrawBtn.disabled = busy || fighters.length >= MAX_ROSTER;
  els.addBtn.disabled = busy || fighters.length >= MAX_ROSTER;
  els.add70.disabled = busy || fighters.length >= MAX_ROSTER;
  els.drawBtn.disabled = busy;
  if (fighters.length >= 2) els.royaleBtn.textContent = `${fighters.length} 人大乱斗 🏟️`;
  else els.royaleBtn.textContent = '大乱斗 🏟️';
}

// ---------- 自定义名单（摇号名单）----------
const SAMPLE_NAMES = [
  '赵子龙', '关云长', '张翼德', '马孟起', '黄汉升',
  '夏侯惇', '典韦', '许仲康', '张辽', '徐晃',
  '吕布', '太史慈', '甘兴霸', '周幼平', '陆伯言',
  '曹孟德', '刘备', '孙权', '诸葛亮', '司马懿',
];

function openRosterModal() {
  els.rosterModal.classList.add('open');
  els.rosterText.focus();
}
function closeRosterModal() {
  els.rosterModal.classList.remove('open');
}

function parseNames() {
  return els.rosterText.value
    .split(/[\n,，、;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function applyRoster(mode) {
  if (busy) return;
  const names = parseNames().slice(0, MAX_ROSTER);
  const take = Math.max(1, Math.min(names.length, Number(els.rosterCountInput.value) || names.length));
  if (!names.length) {
    setStatus('名单为空，请先填写姓名', 'err');
    return;
  }
  try {
    busy = true;
    updateButtons();
    const res = await api.roster({ names: names.slice(0, take), mode });
    setStatus(`${mode === 'replace' ? '替换' : '追加'}名单：${res.count} 人上场`, 'ok');
    closeRosterModal();
    await refresh();
    syncArenaRoster();
  } catch (err) {
    setStatus(err.message, 'err');
  } finally {
    busy = false;
    updateButtons();
  }
}

async function refresh() {
  const state = await api.state();
  fighters = state.fighters;
  leaderboard = state.leaderboard;
  byId = new Map(fighters.map((f) => [f.id, f]));

  if (selection.A && !byId.has(selection.A.id)) selection.A = null;
  if (selection.B && !byId.has(selection.B.id)) selection.B = null;
  if (!selection.A && fighters[0]) selection.A = fighters[0];
  if (!selection.B && fighters[1]) selection.B = fighters[1];
  if (selection.B && selection.A && selection.B.id === selection.A.id) {
    selection.B = fighters.find((f) => f.id !== selection.A.id) || null;
  }

  renderRoster();
  renderLeaderboard();
  renderSlots();
  updateButtons();
}

function syncArenaRoster() {
  // 场上阵容 = 全部小人（最多 70）。
  const roster = fighters.slice(0, MAX_ROSTER);
  const key = roster.map((f) => f.id).join(',');
  if (arena._key !== key) {
    arena._key = key;
    arena.setRoster(roster);
  }
}

async function selectFighter(id) {
  if (busy) return;
  const fighter = byId.get(id);
  if (!fighter) return;
  if (selection.A?.id === id) {
    selection.B = fighter;
    selection.A = fighters.find((f) => f.id !== id) || selection.A;
  } else if (selection.B?.id === id) {
    selection.A = fighter;
    selection.B = fighters.find((f) => f.id !== id) || selection.B;
  } else {
    selection.B = fighter;
  }
  renderRoster();
  renderLeaderboard();
  renderSlots();
}

async function drawFighters(count) {
  if (busy) return;
  try {
    busy = true;
    updateButtons();
    const current = fighters.length;
    const room = Math.max(0, MAX_ROSTER - current);
    const add = Math.min(count, room);
    if (add <= 0) {
      setStatus(`已达上限 ${MAX_ROSTER} 名`, 'err');
      return;
    }
    await api.drawBatch(add);
    setStatus(`抽取 ${add} 名，共 ${current + add} 名`, 'ok');
    await refresh();
    syncArenaRoster();
  } catch (err) {
    setStatus(err.message, 'err');
  } finally {
    busy = false;
    updateButtons();
  }
}

async function doRoyale() {
  if (busy || fighters.length < 2) return;
  try {
    busy = true;
    updateButtons();
    els.championBanner.style.display = 'none';
    els.hpOverlay.style.display = 'none';
    els.roundBadge.style.display = 'block';
    els.roundBadge.textContent = '准备…';
    els.log.innerHTML = '';
    pushLog(`🏟️ ${fighters.length} 人同台大乱斗！`, 'info');
    const res = await api.royale({ size: Math.min(MAX_ROSTER, fighters.length) });
    leaderboard = res.leaderboard;
    renderLeaderboard();
    arena.playRoyale(res.result);
  } catch (err) {
    setStatus(err.message, 'err');
    busy = false;
    updateButtons();
  }
}

async function doDuel() {
  if (busy || !selection.A || !selection.B) return;
  try {
    busy = true;
    updateButtons();
    els.championBanner.style.display = 'none';
    els.hpOverlay.style.display = 'flex';
    els.roundBadge.style.display = 'none';
    els.log.innerHTML = '';
    const bestOf = Number(els.bestOf.value) || 1;
    const res = await api.battle({ a: selection.A.number, b: selection.B.number, bestOf });
    leaderboard = res.leaderboard;
    renderLeaderboard();
    const result = bestOf > 1 ? res.result.games[res.result.games.length - 1] : res.result;
    const duel = {
      ...result,
      fighters: [selection.A.id, selection.B.id],
    };
    arena.playDuel(duel);
  } catch (err) {
    setStatus(err.message, 'err');
    busy = false;
    updateButtons();
  }
}

els.drawBtn.addEventListener('click', async () => {
  const v = els.numberInput.value.trim();
  if (busy) return;
  try {
    busy = true;
    updateButtons();
    const res = await api.draw(v === '' ? undefined : Number(v));
    setStatus(res.created ? `抽到新小人：${res.fighter.name}` : `号码 #${res.fighter.number} 已存在，直接取出`, 'ok');
    await refresh();
    syncArenaRoster();
  } catch (err) {
    setStatus(err.message, 'err');
  } finally {
    busy = false;
    updateButtons();
  }
});
els.numberInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.drawBtn.click();
});
els.autoDrawBtn.addEventListener('click', () => drawFighters(2));
els.add70.addEventListener('click', () => drawFighters(MAX_ROSTER - fighters.length));
els.addBtn.addEventListener('click', () => {
  const n = Number(els.addNumber.value) || 1;
  drawFighters(n);
});
els.royaleBtn.addEventListener('click', doRoyale);
els.battleBtn.addEventListener('click', doDuel);
els.resetBtn.addEventListener('click', async () => {
  if (busy || !confirm('确定清空全部小人和战绩？')) return;
  await api.reset();
  selection = { A: null, B: null };
  arena._key = null;
  arena.clearRoster();
  els.championBanner.style.display = 'none';
  els.roundBadge.style.display = 'none';
  setStatus('已重置', '');
  await refresh();
});
els.roster.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (btn) selectFighter(btn.dataset.id);
});
els.rosterSearch.addEventListener('input', () => {
  filter = els.rosterSearch.value.trim();
  renderRoster();
});

els.rosterBtn.addEventListener('click', openRosterModal);
els.rosterClose.addEventListener('click', closeRosterModal);
els.rosterModal.addEventListener('click', (e) => {
  if (e.target === els.rosterModal) closeRosterModal();
});
els.sampleBtn.addEventListener('click', () => {
  els.rosterText.value = SAMPLE_NAMES.join('\n');
  els.rosterCountInput.value = SAMPLE_NAMES.length;
});
els.rosterAppend.addEventListener('click', () => applyRoster('append'));
els.rosterReplace.addEventListener('click', () => applyRoster('replace'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeRosterModal();
});

window.addEventListener('error', (e) => {
  setStatus(`脚本错误：${e.message}`, 'err');
  pushLog(`⚠️ ${e.message}`, 'err');
});
window.addEventListener('unhandledrejection', (e) => {
  setStatus(`异步错误：${e.reason}`, 'err');
  pushLog(`⚠️ ${e.reason}`, 'err');
});

refresh()
  .then(() => {
    syncArenaRoster();
    setStatus('准备就绪', 'ok');
  })
  .catch((err) => setStatus(err.message, 'err'));
