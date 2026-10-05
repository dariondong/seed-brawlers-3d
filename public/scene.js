import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/addons/controls/OrbitControls.js';
import { buildHumanoid } from './humanoid.js';

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;
const clamp01 = (t) => Math.max(0, Math.min(1, t));

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

// 姓名牌：用 canvas 画一张贴图挂在头顶。
function makeNameSprite(fighter, scale) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 512;
  canvas.height = 128;

  const label = `#${fighter.number} ${fighter.name}`;
  ctx.font = 'bold 52px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  const textW = Math.min(canvas.width - 24, ctx.measureText(label).width);
  const pad = 20;
  const boxW = textW + pad * 2;
  const x = (canvas.width - boxW) / 2;

  ctx.fillStyle = 'rgba(6,9,20,0.82)';
  ctx.strokeStyle = fighter.color;
  ctx.lineWidth = 4;
  roundRect(ctx, x, 20, boxW, 88, 20);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#eaf1ff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, canvas.width / 2, 66);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 2;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2 * scale, 0.5 * scale, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05060d');
    this.scene.fog = new THREE.Fog('#05060d', 16, 46);

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
    this.shake = 0;
    this.clock = new THREE.Clock();
    this.elapsed = 0;

    this.sparks = [];

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
    this.#animate();
  }

  #buildWorld() {
    this.hemi = new THREE.HemisphereLight('#8fb2ff', '#0a0a14', 1.0);
    this.scene.add(this.hemi);

    this.key = new THREE.DirectionalLight('#ffffff', 1.7);
    this.key.position.set(6, 12, 7);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.camera.near = 1;
    this.key.shadow.camera.far = 60;
    this.scene.add(this.key);

    const rimA = new THREE.PointLight('#ff4d6d', 8, 30, 2);
    rimA.position.set(-12, 6, -6);
    this.scene.add(rimA);
    const rimB = new THREE.PointLight('#4dabff', 8, 30, 2);
    rimB.position.set(12, 6, -6);
    this.scene.add(rimB);

    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      new THREE.MeshStandardMaterial({ color: '#0d1020', metalness: 0.5, roughness: 0.78 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.06, 128),
      new THREE.MeshBasicMaterial({ color: '#4dabff', side: THREE.DoubleSide, transparent: true, opacity: 0.55 }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.01;
    this.scene.add(this.ring);

    this.grid = new THREE.GridHelper(40, 40, '#1b2540', '#121a2e');
    this.grid.position.y = 0.004;
    this.scene.add(this.grid);

    this.contactLight = new THREE.PointLight('#ffffff', 0, 10, 2);
    this.contactLight.position.set(0, 1.2, 0);
    this.scene.add(this.contactLight);
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
    this.scene.fog = n > 24 ? null : new THREE.Fog('#05060d', 26, 60);

    const radius = n <= 2 ? 3 : Math.max(3.2, 0.95 * Math.sqrt(n)) + 1.8;
    this.floor.geometry.dispose();
    this.floor.geometry = new THREE.CircleGeometry(radius, 96);
    this.ring.geometry.dispose();
    this.ring.geometry = new THREE.RingGeometry(radius - 0.12, radius, 160);
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

    if (localT > 0.5 && localT < 0.62) this.shake = Math.max(this.shake, 0.1);
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
      anim.t += dt * (anim.speed || 1);
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

  #sparkAt(x, z) {
    const geo = new THREE.SphereGeometry(0.1, 10, 10);
    const material = new THREE.MeshBasicMaterial({ color: '#fff2b0', transparent: true, opacity: 0.9, wireframe: true });
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, 1.05, z);
    this.scene.add(mesh);
    this.sparks.push({ mesh, life: 0, max: 0.35 });
    this.contactLight.position.set(x, 1.2, z);
    this.contactLight.intensity = 6;
  }

  #animate() {
    this._raf = requestAnimationFrame(() => this.#animate());
    const dt = Math.min(0.05, this.clock.getDelta());
    this.elapsed += dt;

    this.#stepAnim(dt);

    const anim = this.anim;
    if (anim?.kind === 'royale' && anim.phase === 'fight' && this.count <= 16) {
      const localT = anim.t / T_FIGHT;
      if (localT > 0.5 && localT < 0.56) {
        for (const c of anim.clashes) this.#sparkAt(c.mx, c.mz);
      }
    }
    if (anim?.kind === 'duel' && anim.phase === 'event') {
      const ev = anim.events[anim.idx];
      if (ev && (ev.type === 'hit' || ev.type === 'critical') && anim.t < 0.02) this.#sparkAt(0, 0);
    }

    for (const e of this.entries.values()) this.#poseEntry(e, dt);

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i];
      sp.life += dt;
      const p = sp.life / sp.max;
      sp.mesh.scale.setScalar(1 + p * 6);
      sp.mesh.material.opacity = Math.max(0, 0.9 * (1 - p));
      if (p >= 1) {
        this.scene.remove(sp.mesh);
        sp.mesh.geometry.dispose();
        sp.mesh.material.dispose();
        this.sparks.splice(i, 1);
      }
    }

    this.contactLight.intensity = Math.max(0, this.contactLight.intensity - dt * 26);
    this.ring.material.opacity = 0.35 + Math.sin(this.elapsed * 2) * 0.16;

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 0.7);
      this.camera.position.x = (Math.random() - 0.5) * this.shake;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
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
