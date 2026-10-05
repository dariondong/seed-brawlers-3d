const json = async (res) => {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
};

export const api = {
  state: () => fetch('/api/state').then(json),
  draw: (number) =>
    fetch('/api/draw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(number === undefined ? {} : { number }),
    }).then(json),
  drawBatch: (count) =>
    fetch('/api/draw/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count }),
    }).then(json),
  battle: (payload) =>
    fetch('/api/battle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    }).then(json),
  royale: (payload) =>
    fetch('/api/royale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    }).then(json),
  roster: (payload) =>
    fetch('/api/roster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    }).then(json),
  rename: (number, name) =>
    fetch('/api/roster/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, name }),
    }).then(json),
  leaderboard: () => fetch('/api/leaderboard').then(json),
  reset: () => fetch('/api/reset', { method: 'POST' }).then(json),
};
