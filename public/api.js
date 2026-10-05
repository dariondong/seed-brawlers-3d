import { LocalBackend } from './backend.js';

const json = async (res) => {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
};

const post = (path, payload) =>
  fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  }).then(json);

// 运行环境侦测：有后端（node server/index.js）就走 HTTP；
// 纯静态托管（GitHub Pages / 直接打开文件）则使用浏览器内置后端 + localStorage。
let mode = null;
let local = null;

function useLocal() {
  if (!local) local = new LocalBackend();
  mode = 'local';
  document.documentElement.dataset.backend = 'local';
  return local;
}

async function ensureMode() {
  if (mode) return mode === 'local' ? local : null;
  try {
    const res = await fetch('/api/health', { headers: { Accept: 'application/json' } });
    const type = res.headers.get('content-type') || '';
    if (res.ok && type.includes('application/json') && (await res.json()).ok) {
      mode = 'remote';
      document.documentElement.dataset.backend = 'remote';
      return null;
    }
  } catch {
    /* 无后端，落回本地模式 */
  }
  return useLocal();
}

export const api = {
  async state() {
    const l = await ensureMode();
    return l ? l.state() : fetch('/api/state').then(json);
  },
  async draw(number) {
    const l = await ensureMode();
    return l ? l.draw(number) : post('/api/draw', number === undefined ? {} : { number });
  },
  async drawBatch(count) {
    const l = await ensureMode();
    return l ? l.drawBatch(count) : post('/api/draw/batch', { count });
  },
  async battle(payload) {
    const l = await ensureMode();
    return l ? l.battle(payload) : post('/api/battle', payload);
  },
  async royale(payload) {
    const l = await ensureMode();
    return l ? l.royale(payload) : post('/api/royale', payload);
  },
  async roster(payload) {
    const l = await ensureMode();
    return l ? l.roster(payload) : post('/api/roster', payload);
  },
  async rename(number, name) {
    const l = await ensureMode();
    return l ? l.rename(number, name) : post('/api/roster/rename', { number, name });
  },
  async leaderboard() {
    const l = await ensureMode();
    return l ? l.leaderboard() : fetch('/api/leaderboard').then(json);
  },
  async reset() {
    const l = await ensureMode();
    return l ? l.reset() : post('/api/reset', {});
  },
};
