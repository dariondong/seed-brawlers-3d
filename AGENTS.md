# AGENTS.md — seed-brawlers-3d

抽号斗士 3D：号码作为种子确定性地生成 3D 小人；自定义名单摇号；2~70 人同台混战；右侧胜率榜。
零构建的原生 ES Module 前端，可跑 Node 后端，也可纯静态（GitHub Pages）。

## 常用命令

```bash
npm install
npm start          # Node 完整服务 → http://localhost:3000
npm run pages      # 同步引擎后起零依赖静态服务器 → http://localhost:4173（等价 Pages）
npm test           # 先 sync:engine，再跑 node:test（36 用例）
npm run e2e        # 浏览器端到端冒烟（需本机 Chromium；先跑 npm run pages）
```

## 架构要点

- **确定性**：`engine/rng.js`（FNV-1a `hashString` + `mulberry32`）→ `engine/fighters.js`
  （号码 → 外观 / 属性 / 姓名）。同号永远同人；名单可覆盖显示姓名。
- **混战引擎**：`engine/royale.js` 导出共享 stepper —— `createMelee` / `spawnPositions` / `DT` /
  `CONTACT`，以及一次跑完的 `simulateRoyale`。前端 3D 场景**用同一个 stepper 逐步推进**，
  保证「看到的过程」与「算出的结果」完全一致，不要另写一套动画逻辑。
- **双模式**：前端先探测 `/api/health`；探测到走 HTTP（`server/`，存 `data/state.json`），
  探测不到则用浏览器内置后端（`public/backend.js`，存 `localStorage`）。
  纯静态模式下 `/api/health` 返回 404 是预期行为。
- **引擎副本**：`public/engine/` 是 `engine/` 的副本，供静态模式使用。
  **改完 `engine/` 必须跑 `npm run sync:engine`（`npm test` 已内置），否则静态模式会漂移**，
  测试里有一条 parity 用例专门守这个。
- **UI 主题**：暗色竞技场（深空底 + 冷调玻璃面板 + 琥珀金重音）。3D 配色常量在
  `public/scene.js` 顶部（`PAPER/PAPER_2/INK/RED/GOLD`），改主题时与 `public/styles.css`
  的 `:root` 变量一起改，两边要保持同一套色。

## 约定

- 中文界面文案；「混战 / 开打」而非「大乱斗 / 淘汰赛」。
- 场景动画主循环用未截断的真实 delta 推进混战（低帧率下也按真实速度打完），
  特效/相机仍用 0.05s 截断的 delta。
