// 浏览器内置后端：GitHub Pages 等纯静态托管没有 Node 服务，直接在前端跑同一套 engine。
// 数据持久化到 localStorage，接口签名与远端 HTTP 版完全一致，main.js 无需区分。
import * as core from './engine/state.js';

const STORAGE_KEY = 'seed-brawlers-3d:state:v1';

export class LocalBackend {
  constructor() {
    this.data = core.createState(this.#load());
    this._saveTimer = null;
  }

  #load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  #save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.data.updatedAt = new Date().toISOString();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      } catch {
        /* 隐私模式等场景下写入失败，忽略即可 */
      }
    }, 120);
  }

  async state() {
    return core.snapshot(this.data);
  }

  async draw(number) {
    const out = core.draw(this.data, number);
    this.#save();
    return out;
  }

  async drawBatch(count) {
    const out = core.drawBatch(this.data, count);
    this.#save();
    return out;
  }

  async battle(payload) {
    const out = core.battle(this.data, payload || {});
    this.#save();
    return out;
  }

  async royale(payload) {
    const out = core.royale(this.data, payload || {});
    this.#save();
    return out;
  }

  async roster(payload) {
    const out = core.setRoster(this.data, payload || {});
    this.#save();
    return out;
  }

  async rename(number, name) {
    const out = core.rename(this.data, number, name);
    this.#save();
    return out;
  }

  async leaderboard() {
    return { leaderboard: core.leaderboard(this.data) };
  }

  async reset() {
    const out = core.reset(this.data);
    this.#save();
    return out;
  }
}
