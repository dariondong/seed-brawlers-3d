// 把共享引擎 engine/*.js 同步到 public/engine/，供纯静态托管（GitHub Pages）直接 import。
// 浏览器不能 import 仓库根目录之外的模块，因此需要一份拷贝；本脚本 + 测试保证二者一致。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'engine');
const DEST = path.join(root, 'public', 'engine');
const FILES = ['rng.js', 'fighters.js', 'battle.js', 'royale.js', 'state.js'];

export function syncEngine({ check = false } = {}) {
  fs.mkdirSync(DEST, { recursive: true });
  const drift = [];
  for (const file of FILES) {
    const src = fs.readFileSync(path.join(SRC, file), 'utf8');
    const destPath = path.join(DEST, file);
    const current = fs.existsSync(destPath) ? fs.readFileSync(destPath, 'utf8') : null;
    if (current !== src) {
      drift.push(file);
      if (!check) fs.writeFileSync(destPath, src);
    }
  }
  return drift;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (process.argv.includes('--check')) {
    const drift = syncEngine({ check: true });
    if (drift.length) {
      console.error(`❌ public/engine 与 engine 不一致：${drift.join(', ')}（请运行 npm run sync:engine）`);
      process.exit(1);
    }
    console.log('✅ public/engine 与 engine 一致');
  } else {
    const changed = syncEngine();
    console.log(changed.length ? `🔄 已同步 ${changed.length} 个文件到 public/engine` : '✅ 无需同步');
  }
}
