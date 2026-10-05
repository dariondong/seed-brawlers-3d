import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/addons/controls/OrbitControls.js';
import { buildHumanoid } from './humanoid.js';

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;
const clamp01 = (t) => Math.max(0, Math.min(1, t));

// 瑞士风格：浅纸面背景 + 墨黑 + 单一红色重音
const PAPER = '#f4f3ef';
const PAPER_2 = '#ffffff';
const INK = '#121212';
const RED = '#e2231a';
const RULE = '#d4d2cb';

// 大乱斗节奏（秒）
const T_INTRO = 0.6;
const T_FIGHT = 1.25;
const T_ROUND_END = 0.55;
const T_CHAMPION = 3;

// 待机/单挑节奏
const T_CHARGE = 0.7;

export function fighterTotalHeight(f) {
  const H = f.body.height;
  const legLen = 0.62 * f.body.legLength * H;
  const torsoLen = 0.6 * H;
  return legLen + 0.06 + torsoLen + 0.36 * f.body.headSize;
}

// 姓名牌：瑞士风格 —— 白底黑字、左侧派系色小块，不发光。
function makeNameSprite(fighter, scale) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 512;
  canvas.height = 128;

  const label = `#${fighter.number} ${fighter.name}`;
  ctx.font = '800 50px "Helvetica Neue","Noto Sans SC","PingFang SC",system-ui,sans-serif';
  const textW = Math.min(canvas.width - 64, ctx.measureText(label).width);
  const pad = 22;
  const block = 16;
  const boxW = textW + pad * 2 + block + 12;
  const x = (canvas.width - boxW) / 2;
  const y = 20;
  const boxH = 88;

  // 白底 + 墨边框（硬边直角）
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillRect(x, y, boxW, boxH);
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.strokeRect(x + 2, y + 2, boxW - 4, boxH - 4);

  // 派系色标
  ctx.fillStyle = fighter.color || RED;
  ctx.fillRect(x + pad, y + (boxH - block) / 2, block, block);

  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + pad + block + 12, y + boxH / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 2;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2 * scale, 0.5 * scale, 1);
  sprite.renderOrder = 20;
  return sprite;
}

// 按人数排布阵型：2 人时左右对立，多人时黄金角螺旋铺满圆形场地。
function formation(count) {
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

export class Arena {
  constructor(canvas, hooks = {}) {
    this.hooks = hooks;
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PAPER);
    this.scene.fog = new THREE.Fog(PAPER, 16, 46);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    this.camera.position.set(0, 3, 9);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.9, 0);
    this.controls.enablePan = false;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 60;
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.#buildWorld();

    this.entries = new Map(); // id -> entry
    this.count = 0;
    this.anim = null;
    this.clock = new THREE.Clock();
    this.elapsed = 0;

    // 相机抖动（基础位 + 抖动偏移）
    this.baseCam = new THREE.Vector3().copy(this.camera.position);
    this.shakeAmp = 0;
    this.shakeDecay = 1;
    // 暂停时不再推进动画时间
    this.paused = false;
    // 大乱斗播放速度（由 UI 控制）
    this.speedScale = 1;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
    this.#animate();
  }

  #buildWorld() {
    // 浅色纸面 + 柔和平行光：整体明亮、对比干净（瑞士风不做霓虹夜场）
    this.hemi = new THREE.HemisphereLight('#ffffff', '#d9d7cf', 1.65);
    this.scene.add(this.hemi);

    this.key = new THREE.DirectionalLight('#ffffff', 1.15);
    this.key.position.set(6, 14, 8);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.camera.near = 1;
    this.key.shadow.camera.far = 70;
    this.scene.add(this.key);

    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      new THREE.MeshStandardMaterial({ color: PAPER_2, metalness: 0.0, roughness: 0.96 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    // 场地外圈：墨黑细线
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.02, 128),
      new THREE.MeshBasicMaterial({ color: INK, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.01;
    this.scene.add(this.ring);

    // 内圈红色细线
    this.ringInner = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.015, 128),
      new THREE.MeshBasicMaterial({ color: RED, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    );
    this.ringInner.rotation.x = -Math.PI / 2;
    this.ringInner.position.y = 0.012;
    this.scene.add(this.ringInner);

    // 排版网格
    this.grid = new THREE.GridHelper(40, 40, '#c9c7bf', '#e2e0d8');
    this.grid.position.y = 0.004;
    this.scene.add(this.grid);

    // 对撞白闪（墨黑场地里只做一下短促提亮）
    this.contactLight = new THREE.PointLight('#ffffff', 0, 12, 2);
    this.contactLight.position.set(0, 1.2, 0);
    this.scene.add(this.contactLight);

    // 命中冲击波 / 速度线 / 墨色粒子（全部用基础材质，浅底上很显眼）
    this.impactPool = [];
    this.impacts = [];
    this.speedLinePool = [];
    this.speedLines = [];
    this.debrisPool = [];
    this.debris = [];
    this.trailPool = [];
    this.trails = [];
  }

  // 淡出回收物件池，避免对撞频繁时反复创建几何体。
  #acquire(pool, make) {
    const obj = pool.pop() || make();
    obj.visible = true;
    return obj;
  }

  #release(pool, obj) {
    obj.visible = false;
    this.scene.remove(obj);
    pool.push(obj);
  }

  clearRoster() {
    for (const e of this.entries.values()) {
      this.scene.remove(e.group);
      disposeTree(e.group);
    }
    this.entries.clear();
    this.count = 0;
    this.anim = null;
    this._key = null;
  }

  // 建立同台阵容（1 ~ 70 人），并调整场地与镜头。
  setRoster(fighters) {
    this.clearRoster();
    const positions = formation(fighters.length);
    const n = fighters.length;
    const lightThreshold = 10;
    const shadowThreshold = 16;
    const perfMode = n > lightThreshold;

    this.renderer.shadowMap.enabled = n <= shadowThreshold;
    this.key.castShadow = n <= shadowThreshold;
    this.renderer.setPixelRatio(perfMode ? 1 : Math.min(window.devicePixelRatio, 2));
    // 大量物体时关闭雾效（每材质都要计算，开销明显）。
    this.scene.fog = n > 24 ? null : new THREE.Fog(PAPER, 26, 62);

    const radius = n <= 2 ? 3 : Math.max(3.2, 0.95 * Math.sqrt(n)) + 1.8;
    this.floor.geometry.dispose();
    this.floor.geometry = new THREE.CircleGeometry(radius, 96);
    this.ring.geometry.dispose();
    this.ring.geometry = new THREE.RingGeometry(radius - 0.06, radius, 160);
    this.ringInner.geometry.dispose();
    this.ringInner.geometry = new THREE.RingGeometry(radius * 0.42, radius * 0.42 + 0.03, 120);
    this.grid.scale.setScalar(radius / 7);

    const nameScale = n > 30 ? 0.72 : n > 12 ? 0.9 : 1;
    const h = new THREE.Vector3();

    fighters.forEach((fighter, i) => {
      const pos = positions[i];
      const group = buildHumanoid(fighter, { light: n <= lightThreshold });
      group.position.set(pos.x, 0, pos.z);
      group.rotation.y = pos.ry;
      this.scene.add(group);

      const nameY = fighterTotalHeight(fighter) + 0.42;
      const sprite = makeNameSprite(fighter, nameScale);
      sprite.position.set(0, nameY, 0);
      group.add(sprite);
      h.set(0, nameY, 0);

      this.entries.set(fighter.id, {
        fighter,
        group,
        sprite,
        nameY,
        home: pos,
        alive: true,
        dead: false,
        deadT: 0,
        tip: 0,
        sink: 0,
        offX: 0,
        offZ: 0,
        bob: Math.random() * Math.PI * 2,
      });
    });

    this.count = n;

    // 镜头框住全场
    const camDist = n <= 2 ? 7.5 : radius * 2.05 + 3;
    const camHeight = n <= 2 ? 2.6 : radius * 0.95 + 2.4;
    this.camera.position.set(0, camHeight, camDist);
    this.controls.target.set(0, n <= 2 ? 0.95 : 1.1, 0);
    this.controls.maxDistance = Math.max(30, camDist * 2.6);
    this.controls.update();
    this.baseCam.copy(this.camera.position);
    if (this.scene.fog) {
      this.scene.fog.near = n <= 2 ? 10 : radius * 1.4;
      this.scene.fog.far = n <= 2 ? 26 : radius * 5 + 20;
    }
  }

  #entry(id) {
    return this.entries.get(id);
  }

  #resetAlive() {
    for (const e of this.entries.values()) {
      e.alive = true;
      e.dead = false;
      e.deadT = 0;
      e.tip = 0;
      e.sink = 0;
      e.offX = 0;
      e.offZ = 0;
      e.group.visible = true;
      e.group.position.y = 0;
      e.group.rotation.set(0, e.home.ry, 0);
      e.group.scale.setScalar(1);
      e.sprite.visible = true;
    }
  }

  // ---------------- 大乱斗 ----------------
  playRoyale(result) {
    this.#resetAlive();
    // 人越多节奏越快，避免 70 人时动画拖到 20 秒以上。
    const size = result.size || this.count;
    const speed = size > 40 ? 2.6 : size > 24 ? 2 : size > 12 ? 1.4 : 1;
    this.anim = {
      kind: 'royale',
      result,
      speed,
      roundIndex: -1,
      phase: 'round-intro',
      t: 0,
      clashes: [],
    };
    this.#beginRound();
  }

  #beginRound() {
    const anim = this.anim;
    anim.roundIndex += 1;
    anim.t = 0;
    anim.phase = 'round-intro';
    const round = anim.result.rounds[anim.roundIndex];
    if (!round) {
      this.anim = null;
      return;
    }
    this.hooks.onRound?.({
      round: round.round,
      totalRounds: anim.result.rounds.length,
      fighters: round.fights.length * 2 + (round.bye ? 1 : 0),
      bye: round.bye,
    });
  }

  #startFightPhase() {
    const anim = this.anim;
    const round = anim.result.rounds[anim.roundIndex];
    anim.clashes = round.fights.map((f) => {
      const ea = this.#entry(f.a);
      const eb = this.#entry(f.b);
      const ax = ea ? ea.home.x + ea.offX : 0;
      const az = ea ? ea.home.z + ea.offZ : 0;
      const bx = eb ? eb.home.x + eb.offX : 0;
      const bz = eb ? eb.home.z + eb.offZ : 0;
      return { ...f, ax, az, bx, bz, mx: (ax + bx) / 2, mz: (az + bz) / 2 };
    });
    anim.phase = 'fight';
    anim.t = 0;
  }

  #applyFightPose(entry, dt) {
    const anim = this.anim;
    const localT = clamp01(anim.t / T_FIGHT);
    const clash = anim.clashes.find((c) => c.a === entry.fighter.id || c.b === entry.fighter.id);
    if (!clash) {
      entry.offX *= 0.85;
      entry.offZ *= 0.85;
      return;
    }

    const isA = clash.a === entry.fighter.id;
    const winner = clash.winner;
    const approach = easeInOut(clamp01(localT / 0.5));
    const homeX = entry.home.x;
    const homeZ = entry.home.z;

    entry.offX = (clash.mx - homeX) * 0.32 * approach;
    entry.offZ = (clash.mz - homeZ) * 0.32 * approach;

    const parts = entry.group.userData.parts;
    const windup = easeOut(clamp01(localT / 0.5));
    const impact = easeOut(clamp01((localT - 0.5) / 0.5));
    parts.leftArm.shoulder.rotation.x = -0.3 - 0.9 * windup;
    parts.rightArm.shoulder.rotation.x = -0.3 - 0.9 * windup;

    if (entry.fighter.id === winner) {
      // 胜者：冲击瞬间前压，随后回到站姿
      const punch = Math.sin(impact * Math.PI);
      parts.rightArm.shoulder.rotation.x = -0.3 - 1.9 * punch;
      parts.leftArm.shoulder.rotation.x = -0.2 + 0.5 * punch;
      entry.offX += Math.sign(clash.mx - homeX) * 0.22 * punch;
      entry.offZ += Math.sign(clash.mz - homeZ) * 0.22 * punch;
      entry.tip = 0;
    } else {
      // 败者：被撞飞、倒地
      const tip = clamp01((localT - 0.6) / 0.4);
      entry.tip = tip * 1.5;
      entry.offX = (clash.mx - homeX) * 0.32 * approach - Math.sign(clash.mx - homeX) * 0.25 * tip;
      entry.offZ = (clash.mz - homeZ) * 0.32 * approach - Math.sign(clash.mz - homeZ) * 0.25 * tip;
      entry.sink = tip * 0.12;
      parts.leftArm.shoulder.rotation.x = 0.9 * tip;
      parts.rightArm.shoulder.rotation.x = 0.9 * tip;
    }

    // 命中瞬间的镜头抖动
    if (localT > 0.44 && localT < 0.6) this.#addShake(0.42, 3.2);
  }

  #applyRoundEndPose(entry, dt) {
    const step = dt / T_ROUND_END;
    if (!entry.alive) {
      entry.deadT = clamp01(entry.deadT + step);
      entry.tip = 1.5;
      entry.sink = 1.7 * easeInOut(entry.deadT);
      entry.group.scale.setScalar(Math.max(0.05, 1 - entry.deadT));
      if (entry.deadT >= 1) {
        entry.dead = true;
        entry.group.visible = false;
        entry.sprite.visible = false;
      }
    } else {
      entry.offX *= 1 - Math.min(1, step);
      entry.offZ *= 1 - Math.min(1, step);
      entry.tip *= 1 - Math.min(1, step);
      entry.sink *= 1 - Math.min(1, step);
    }
  }

  #finishRound() {
    const anim = this.anim;
    const round = anim.result.rounds[anim.roundIndex];
    for (const f of round.fights) {
      const loser = this.#entry(f.loser);
      if (loser) loser.alive = false;
      this.hooks.onFight?.(f);
    }
    anim.phase = 'round-end';
    anim.t = 0;
  }

  #advanceAfterRound() {
    const anim = this.anim;
    const last = anim.roundIndex >= anim.result.rounds.length - 1;
    if (last) {
      anim.phase = 'champion';
      anim.t = 0;
      const champ = this.#entry(anim.result.champion.id);
      if (champ) {
        champ.group.visible = true;
        champ.sprite.visible = true;
      }
      this.hooks.onChampion?.(anim.result.champion);
      return;
    }
    this.#beginRound();
  }

  // ---------------- 单挑 ----------------
  playDuel(result) {
    this.#resetAlive();
    this.anim = {
      kind: 'duel',
      result,
      phase: 'charge',
      t: 0,
      events: result.events,
      idx: 0,
    };
    const hp = {};
    for (const id of result.fighters) {
      const e = this.#entry(id);
      if (e) hp[id] = e.fighter.derived.maxHp;
    }
    this.hooks.onHp?.(hp);
  }

  #applyDuelPose(entry, dt) {
    const anim = this.anim;
    const isA = entry.fighter.id === anim.result.fighters[0];
    const dir = isA ? 1 : -1;
    const parts = entry.group.userData.parts;

    const resetArms = () => {
      parts.leftArm.shoulder.rotation.x = -0.06;
      parts.rightArm.shoulder.rotation.x = -0.06;
      parts.leftArm.elbow.rotation.x = -0.25;
      parts.rightArm.elbow.rotation.x = -0.25;
    };
    resetArms();

    if (anim.phase === 'charge') {
      const e = easeInOut(clamp01(anim.t / T_CHARGE));
      entry.offX = dir * 0.5 * e;
      parts.leftArm.shoulder.rotation.x = -0.5 * e;
      parts.rightArm.shoulder.rotation.x = -0.5 * e;
      return;
    }

    if (anim.phase !== 'event') return;
    const ev = anim.events[anim.idx];
    if (!ev) return;
    const dur = ev.type === 'miss' ? 0.34 : 0.46;
    const localT = clamp01(anim.t / dur);
    const isActor = ev.actor === entry.fighter.id;
    const isTarget = ev.target === entry.fighter.id;

    if (isActor) {
      const strike = Math.sin(easeOut(localT) * Math.PI);
      entry.offX = dir * (0.5 + 0.35 * strike);
      parts.leftArm.shoulder.rotation.x = -0.5 - 1.7 * strike;
      parts.rightArm.shoulder.rotation.x = -0.4 + 0.4 * strike;
      entry.group.userData.parts.pelvis.rotation.y = dir * 0.28 * strike;
    } else if (isTarget) {
      const recoil = localT > 0.4 ? Math.sin(easeOut((localT - 0.4) / 0.6) * Math.PI) : 0;
      entry.offX = dir * 0.5 - dir * 0.3 * recoil;
      entry.tip = 0.35 * recoil;
    } else {
      entry.offX = dir * 0.2;
    }
  }

  #applyDuelFinish() {
    const anim = this.anim;
    for (const e of this.entries.values()) {
      if (anim.result.winner === e.fighter.id) {
        e.group.userData.parts.leftArm.shoulder.rotation.x = -2.4;
        e.group.userData.parts.rightArm.shoulder.rotation.x = -2.4;
        e.bob = Math.abs(Math.sin(this.elapsed * 6)) * 0.12;
      } else if (anim.result.winner) {
        e.tip = 1.2;
        e.sink = 0.3;
      }
    }
  }

  // ---------------- 帧循环 ----------------
  #poseEntry(entry, dt) {
    const g = entry.group;
    if (!g.visible) return;

    const parts = g.userData.parts;
    let px = entry.home.x + entry.offX;
    let pz = entry.home.z + entry.offZ;
    let py = 0;
    let tip = entry.tip;

    // 呼吸 / 轻微摇摆
    const s = Math.sin(this.elapsed * 2.2 + entry.bob);
    if (!this.anim) {
      parts.leftArm.shoulder.rotation.x = -0.06 + s * 0.05;
      parts.rightArm.shoulder.rotation.x = -0.06 - s * 0.05;
      parts.leftArm.elbow.rotation.x = -0.25;
      parts.rightArm.elbow.rotation.x = -0.25;
      parts.pelvis.rotation.y = Math.sin(this.elapsed * 1.2 + entry.bob) * 0.05;
      py += s * 0.015;
    }

    const anim = this.anim;
    if (anim?.kind === 'royale') {
      if (anim.phase === 'fight') this.#applyFightPose(entry, dt);
      else if (anim.phase === 'round-end') this.#applyRoundEndPose(entry, dt);
      else {
        entry.offX *= 0.86;
        entry.offZ *= 0.86;
      }
      px = entry.home.x + entry.offX;
      pz = entry.home.z + entry.offZ;
      tip = entry.tip;
      py = -entry.sink;

      if (anim.phase === 'champion' && anim.result.champion.id === entry.fighter.id) {
        const hop = Math.abs(Math.sin(this.elapsed * 4));
        py += hop * 0.25;
        parts.leftArm.shoulder.rotation.x = -2.6;
        parts.rightArm.shoulder.rotation.x = -2.6;
        entry.tip = 0;
        tip = 0;
      }
    } else if (anim?.kind === 'duel') {
      this.#applyDuelPose(entry, dt);
      if (anim.phase === 'finish') this.#applyDuelFinish();
      // offX 已带方向（A 为正、B 为负），直接叠加到主位即可。
      px = entry.home.x + entry.offX;
      py = -entry.sink + entry.bob;
      tip = entry.tip;
    }

    g.position.set(px, py, pz);
    g.rotation.set(0, entry.home.ry, tip);
  }

  #stepAnim(dt) {
    const anim = this.anim;
    if (!anim) return;

    if (anim.kind === 'royale') {
      anim.t += dt * (anim.speed || 1) * this.speedScale;
      if (anim.phase === 'round-intro') {
        if (anim.t >= T_INTRO) this.#startFightPhase();
      } else if (anim.phase === 'fight') {
        if (anim.t >= T_FIGHT) this.#finishRound();
      } else if (anim.phase === 'round-end') {
        if (anim.t >= T_ROUND_END) this.#advanceAfterRound();
      } else if (anim.phase === 'champion') {
        if (anim.t >= T_CHAMPION) {
          this.anim = null;
          this.hooks.onRoyaleEnd?.(anim.result);
        }
      }
      return;
    }

    if (anim.kind === 'duel') {
      anim.t += dt;
      if (anim.phase === 'charge') {
        if (anim.t >= T_CHARGE) {
          anim.phase = 'event';
          anim.idx = 0;
          anim.t = 0;
        }
        return;
      }
      if (anim.phase === 'event') {
        const ev = anim.events[anim.idx];
        if (!ev) {
          anim.phase = 'finish';
          anim.t = 0;
          this.hooks.onDuelFinish?.(anim.result);
          return;
        }
        const dur = ev.type === 'miss' ? 0.34 : 0.46;
        if (anim.t >= dur) {
          anim.idx += 1;
          anim.t = 0;
          this.hooks.onDuelEvent?.(ev);
          if (anim.idx >= anim.events.length) {
            anim.phase = 'finish';
            anim.t = 0;
            this.hooks.onDuelFinish?.(anim.result);
          }
        }
      }
      return;
    }
  }

  // 命中：白闪 + 双层冲击环 + 放射速度线 + 墨色碎块 + 镜头抖动。
  // strong=true 用于淘汰/暴击，弱命中只出环和粉。
  #impact(x, z, { color = RED, strong = false } = {}) {
    const y = strong ? 1.15 : 1.02;

    // 白闪
    this.contactLight.position.set(x, y + 0.15, z);
    this.contactLight.intensity = strong ? 9 : 5;

    // 冲击环（面向相机的扁平圆环，向外扩张）
    const ringCount = strong ? 2 : 1;
    for (let i = 0; i < ringCount; i++) {
      const ring = this.#acquire(this.impactPool, () => {
        const m = new THREE.Mesh(
          new THREE.RingGeometry(0.42, 0.5, 48),
          new THREE.MeshBasicMaterial({ color: INK, side: THREE.DoubleSide, transparent: true }),
        );
        this.scene.add(m);
        return m;
      });
      ring.position.set(x, y, z);
      ring.scale.setScalar(0.4 + i * 0.3);
      ring.material.color.set(i === 0 ? (strong ? RED : INK) : INK);
      this.impacts.push({ mesh: ring, life: 0, max: strong ? 0.5 : 0.36, grow: strong ? 11 : 7, delay: i * 0.06, opacity: strong ? 0.95 : 0.8, flat: !strong });
    }

    // 速度线：从命中点向四周放射的细线
    const lines = strong ? 9 : 5;
    for (let i = 0; i < lines; i++) {
      const line = this.#acquire(this.speedLinePool, () => {
        const geo = new THREE.BoxGeometry(0.03, 0.03, 1);
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: INK, transparent: true }));
        this.scene.add(m);
        return m;
      });
      const th = Math.random() * Math.PI * 2;
      line.position.set(x, y, z);
      line.rotation.set(0, -th, 0);
      line.scale.z = 1;
      this.speedLines.push({
        mesh: line,
        life: 0,
        max: strong ? 0.42 : 0.3,
        th,
        y,
        speed: (strong ? 5.2 : 3.4) * (0.7 + Math.random() * 0.6),
        color: Math.random() < 0.28 ? RED : INK,
      });
    }

    // 墨色碎块（重力抛物线）
    const chunks = strong ? 12 : 5;
    for (let i = 0; i < chunks; i++) {
      const piece = this.#acquire(this.debrisPool, () => {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.07, 0.07, 0.07),
          new THREE.MeshBasicMaterial({ color: INK }),
        );
        this.scene.add(m);
        return m;
      });
      const th = Math.random() * Math.PI * 2;
      const sp = (strong ? 2.6 : 1.7) * (0.5 + Math.random());
      piece.position.set(x, y, z);
      piece.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      this.debris.push({
        mesh: piece,
        vx: Math.cos(th) * sp,
        vz: Math.sin(th) * sp,
        vy: 1.6 + Math.random() * 2.2,
        life: 0,
        max: 0.6 + Math.random() * 0.35,
        spin: (Math.random() - 0.5) * 12,
        color: Math.random() < 0.3 ? RED : INK,
      });
    }

    this.#addShake(strong ? 0.5 : 0.26, strong ? 2.4 : 3.4);
  }

  // 施招瞬间的拖尾（只给出手者）
  #trail(entry, dirX, dirZ) {
    const g = entry.group;
    const trail = this.#acquire(this.trailPool, () => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.075, 0.9, 0.5),
        new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.5 }),
      );
      this.scene.add(m);
      return m;
    });
    trail.position.set(g.position.x - dirX * 0.22, 0.62, g.position.z - dirZ * 0.22);
    trail.rotation.y = Math.atan2(dirX, dirZ);
    trail.scale.set(1, 1, 1);
    this.trails.push({ mesh: trail, life: 0, max: 0.26 });
  }

  #addShake(amp, decay) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeDecay = decay;
  }

  #animate() {
    this._raf = requestAnimationFrame(() => this.#animate());
    const raw = Math.min(0.05, this.clock.getDelta());
    // 暂停时冻结动画时间与特效，但仍持续渲染（保留可交互的相机）。
    const dt = this.paused ? 0 : raw;
    this.elapsed += dt;

    if (dt > 0) this.#stepAnim(dt);

    const anim = this.anim;
    if (dt > 0 && anim?.kind === 'royale' && anim.phase === 'fight' && this.count <= 40) {
      const localT = anim.t / T_FIGHT;
      if (localT > 0.44 && localT < 0.6) {
        for (const c of anim.clashes) {
          if (!c._impacted) {
            c._impacted = true;
            // 淘汰对手的一击 = strong，冲击感更强。
            this.#impact(c.mx, c.mz, { strong: true });
            // 出手者拖尾
            const actor = this.#entry(c.winner);
            const loser = this.#entry(c.winner === c.a ? c.b : c.a);
            if (actor && loser) {
              const dx = loser.group.position.x - actor.group.position.x;
              const dz = loser.group.position.z - actor.group.position.z;
              const len = Math.hypot(dx, dz) || 1;
              this.#trail(actor, dx / len, dz / len);
            }
          }
        }
      }
    }
    if (dt > 0 && anim?.kind === 'duel' && anim.phase === 'event') {
      const ev = anim.events[anim.idx];
      if (ev && (ev.type === 'hit' || ev.type === 'critical') && anim.t < 0.03) {
        this.#impact(0, 0, { strong: ev.type === 'critical' });
      }
    }

    for (const e of this.entries.values()) this.#poseEntry(e, dt);

    this.#stepEffects(dt);

    this.contactLight.intensity = Math.max(0, this.contactLight.intensity - raw * 30);
    this.ring.material.opacity = 0.6 + Math.sin(this.elapsed * 1.6) * 0.14;

    // 相机抖动：始终从基础机位起算，避免累积漂移。
    if (this.shakeAmp > 0.001) {
      this.shakeAmp = Math.max(0, this.shakeAmp - raw * this.shakeDecay);
      const a = this.shakeAmp * 0.5;
      this.camera.position.x = this.baseCam.x + (Math.random() - 0.5) * a;
      this.camera.position.y = this.baseCam.y + (Math.random() - 0.5) * a;
      this.camera.position.z = this.baseCam.z + (Math.random() - 0.5) * a * 0.5;
    } else if (this.shakeAmp !== 0) {
      this.shakeAmp = 0;
      this.camera.position.copy(this.baseCam);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // 推进并回收所有冲击特效。
  #stepEffects(dt) {
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const it = this.impacts[i];
      it.life += dt;
      const p = clamp01((it.life - it.delay) / it.max);
      if (it.life < it.delay) continue;
      it.mesh.scale.setScalar(0.4 + p * it.grow);
      it.mesh.material.opacity = Math.max(0, it.opacity * (1 - p));
      if (p >= 1) {
        this.#release(this.impactPool, it.mesh);
        this.impacts.splice(i, 1);
      }
    }

    for (let i = this.speedLines.length - 1; i >= 0; i--) {
      const s = this.speedLines[i];
      s.life += dt;
      const p = clamp01(s.life / s.max);
      s.mesh.scale.z = s.speed * 0.9 * (1 - p) + 0.2;
      // 沿自身方向推进
      s.mesh.position.x += Math.sin(s.th) * (s.speed * dt);
      s.mesh.position.z += Math.cos(s.th) * (s.speed * dt);
      s.mesh.position.y = s.y + Math.sin(p * Math.PI) * 0.12;
      s.mesh.material.color.set(s.color);
      s.mesh.material.opacity = Math.max(0, (1 - p) * 0.85);
      if (p >= 1) {
        this.#release(this.speedLinePool, s.mesh);
        this.speedLines.splice(i, 1);
      }
    }

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life += dt;
      const p = clamp01(d.life / d.max);
      d.vy -= 9.5 * dt;
      d.mesh.position.x += d.vx * dt;
      d.mesh.position.z += d.vz * dt;
      d.mesh.position.y += d.vy * dt;
      d.mesh.rotation.x += d.spin * dt;
      d.mesh.rotation.z += d.spin * dt;
      d.mesh.material.color.set(d.color);
      d.mesh.scale.setScalar(Math.max(0.05, 1 - p));
      if (d.mesh.position.y < 0.04) d.mesh.position.y = 0.04;
      if (p >= 1) {
        this.#release(this.debrisPool, d.mesh);
        this.debris.splice(i, 1);
      }
    }

    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i];
      t.life += dt;
      const p = clamp01(t.life / t.max);
      t.mesh.material.opacity = Math.max(0, 0.5 * (1 - p));
      t.mesh.scale.set(1 - p * 0.6, 1, 1 + p * 0.8);
      if (p >= 1) {
        this.#release(this.trailPool, t.mesh);
        this.trails.splice(i, 1);
      }
    }
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth || window.innerWidth;
    const h = parent.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
  }
}

function disposeTree(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}
