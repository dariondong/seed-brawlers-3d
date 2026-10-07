import * as THREE from './vendor/three.module.js';

// 2.5D 卡通着色：3~4 级色阶的渐变贴图，让受光面呈现硬边平涂，而不是写实过渡。
let _gradient = null;
function toonGradient() {
  if (_gradient) return _gradient;
  const data = new Uint8Array([92, 150, 206, 255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  _gradient = tex;
  return tex;
}

function mat(color, { emissive = '#000000', emissiveIntensity = 0 } = {}) {
  return new THREE.MeshToonMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(emissive),
    emissiveIntensity,
    gradientMap: toonGradient(),
  });
}

function shade(hex, amount) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amount)));
  return c;
}

// 用基础几何体拼出一个方块风格的 3D 小人。
// fighter.body / color 相同 → 外观完全相同（确定性）。
// opts.light：是否附带自发光点光源。人数很多时必须关闭，否则大量动态光源会拖垮 WebGL。
export function buildHumanoid(fighter, { light = true } = {}) {
  const { body, color, glow } = fighter;
  const root = new THREE.Group();
  root.name = fighter.id;

  // 2.5D 平涂：色阶卡通材质，靠明度差区分躯干与四肢；不加高光。
  // 自发光保持 0.25：环境光偏暗时也保证小人本色不丢失（不额外增加动态光源开销）。
  const skin = mat(color, { emissive: color, emissiveIntensity: 0.25 });
  const armor = mat(shade(color, -0.3), { emissive: shade(color, -0.3), emissiveIntensity: 0.25 });
  const core = new THREE.MeshBasicMaterial({ color: new THREE.Color(glow) });

  const H = body.height;
  const B = body.bulk;

  const legLen = 0.62 * body.legLength * H;
  const torsoLen = 0.6 * H;
  const armLen = 0.56 * body.armLength * H;

  const pelvis = new THREE.Group();
  pelvis.position.y = legLen + 0.06;
  root.add(pelvis);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62 * B * body.shoulder, torsoLen, 0.42 * B), armor);
  torso.position.y = torsoLen / 2;
  torso.castShadow = true;
  pelvis.add(torso);

  const coreMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09 * B, 16, 16), core);
  coreMesh.position.set(0, torsoLen * 0.62, 0.24 * B);
  pelvis.add(coreMesh);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.36 * body.headSize, 0.36 * body.headSize, 0.34 * body.headSize),
    skin,
  );
  head.position.y = torsoLen + 0.22 * body.headSize;
  head.castShadow = true;
  pelvis.add(head);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3 * body.headSize, 0.07, 0.03), core);
  visor.position.set(0, 0.02, 0.18 * body.headSize);
  head.add(visor);

  function makeArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.34 * B * body.shoulder, torsoLen * 0.94, 0);
    shoulder.rotation.z = side * 0.14;
    pelvis.add(shoulder);

    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.17 * B, armLen, 0.17 * B), skin);
    upper.position.y = -armLen / 2;
    upper.castShadow = true;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -armLen;
    shoulder.add(elbow);

    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.15 * B, armLen * 0.85, 0.15 * B), armor);
    lower.position.y = -armLen * 0.425;
    lower.castShadow = true;
    elbow.add(lower);

    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.2 * B, 0.2 * B, 0.2 * B), skin);
    fist.position.y = -armLen * 0.9;
    elbow.add(fist);

    return { shoulder, elbow, fist };
  }

  function makeLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.16 * B, 0.06, 0);
    root.add(hip);

    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.2 * B, legLen, 0.2 * B), armor);
    upper.position.y = -legLen / 2;
    upper.castShadow = true;
    hip.add(upper);

    const knee = new THREE.Group();
    knee.position.y = -legLen;
    hip.add(knee);

    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.18 * B, legLen * 0.9, 0.18 * B), skin);
    lower.position.y = -legLen * 0.45;
    lower.castShadow = true;
    knee.add(lower);

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.22 * B, 0.1, 0.3), armor);
    foot.position.set(0, -legLen * 0.92, 0.05);
    knee.add(foot);

    return { hip, knee };
  }

  const leftArm = makeArm(1);
  const rightArm = makeArm(-1);
  const leftLeg = makeLeg(1);
  const rightLeg = makeLeg(-1);

  // 2.5D 扁平投影：脚下一块深色圆斑，代替写实软阴影（更贴平涂风、且更省）。
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.42 * B, 24),
    new THREE.MeshBasicMaterial({
      color: '#05070c',
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  root.add(shadow);

  let aura = null;
  if (light) {
    aura = new THREE.PointLight(new THREE.Color(glow), 1.1, 4.2, 2);
    aura.position.set(0, 1.0, 0);
    root.add(aura);
  }

  root.userData = {
    fighterId: fighter.id,
    parts: { pelvis, torso, head, coreMesh, leftArm, rightArm, leftLeg, rightLeg, aura, shadow },
  };

  return root;
}
