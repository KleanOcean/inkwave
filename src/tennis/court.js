import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COURT, TARGETS } from './simulation.js';
import { TennisEffects } from './effects.js';

const UP = new THREE.Vector3(0, 1, 0);
const PALETTE = { cream: '#f3f0e7', green: '#153d35', lime: '#e5f67a', coral: '#ff845c', lavender: '#a59bf8' };

// One small scene, with no ink textures, environment maps or postprocessing render targets.
export class TennisCourt {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor('#ede9dd');
    this.canvas = this.renderer.domElement;
    this.canvas.id = 'tennis-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', '3D 网球场：WASD 或方向键跑位，鼠标瞄准，按住并松开空格或鼠标左键挥拍。');
    container.appendChild(this.canvas);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#ede9dd');
    this.scene.fog = new THREE.Fog('#ede9dd', 55, 95);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    this.cameraBase = new THREE.Vector3();
    this.cameraTarget = new THREE.Vector3();
    this.cameraImpact = { age: 9, duration: 0.2, strength: 0, direction: 1 };
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.ground = new THREE.Plane(UP, 0);
    this.point = new THREE.Vector3();
    this.scene.add(new THREE.HemisphereLight('#fff4dd', '#536e68', 2.2));
    const sun = new THREE.DirectionalLight('#fff2d5', 3.1);
    sun.position.set(-12, 24, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -21, right: 21, top: 23, bottom: -23, near: 1, far: 70 });
    sun.shadow.normalBias = 0.035;
    sun.shadow.bias = -0.0002;
    this.scene.add(sun);
    this.materials = new Map();
    this.geometries = new Map();
    this.practiceProps = new THREE.Group();
    this.practiceProps.name = 'practice-props';
    this.scene.add(this.practiceProps);
    this.buildCourt();
    this.buildSurroundings();
    this.buildMachine();
    this.mergeStaticGeometry();
    this.buildPlayer();
    this.ball = this.sphere(COURT.ballRadius, PALETTE.lime);
    this.ball.material = this.ball.material.clone();
    this.ball.castShadow = true;
    // A seam remains visible without a high-resolution tennis-ball texture.
    const seam = new THREE.Mesh(new THREE.TorusGeometry(COURT.ballRadius * 0.98, 0.009, 4, 24), this.material(PALETTE.cream));
    seam.rotation.x = 0.45;
    this.ball.add(seam);
    this.ballShadow = this.disc(0.2, '#17392f', 0.28);
    this.aimMarker = this.ring(0.42, 0.49, PALETTE.cream);
    this.aimMarker.position.y = 0.06;
    this.landingMarker = this.ring(0.27, 0.32, PALETTE.lime);
    this.landingMarker.position.y = 0.055;
    this.playerRing = this.ring(0.58, 0.65, PALETTE.cream);
    this.playerRing.position.y = 0.04;
    this.swingTime = 1;
    this.visualTime = 0;
    this.actorActions = {
      player: { type: '', age: 9, stroke: 'forehand', quality: 1, charge: 0 },
      bot: { type: '', age: 9, stroke: 'forehand', quality: 1, charge: 0 },
    };
    this.winner = null;
    this.effects = new TennisEffects(this.scene);
    this.racketTip = { player: new THREE.Vector3(), bot: new THREE.Vector3() };
    this.ballVelocity = new THREE.Vector3();
    this.ballDirection = new THREE.Vector3();
    this.lastPlayer = { x: 0, z: 9 };
    this.lastBot = { x: 0, z: -9 };
    this.phase = 'ready';
    this.resize();
  }

  material(color) {
    if (!this.materials.has(color)) this.materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
    return this.materials.get(color);
  }

  mergeStaticGeometry() {
    // Draw static props together by material; the animated player and ball remain separate.
    this.scene.updateMatrixWorld(true);
    const groups = new Map();
    this.scene.traverse((object) => {
      if (!object.isMesh || !object.material.isMeshStandardMaterial) return;
      let parent = object;
      while (parent) {
        if (parent === this.practiceProps) return;
        parent = parent.parent;
      }
      const group = groups.get(object.material) || [];
      group.push(object);
      groups.set(object.material, group);
    });
    for (const [material, objects] of groups) {
      const parts = objects.map((object) => object.geometry.clone().applyMatrix4(object.matrixWorld));
      const geometry = mergeGeometries(parts, false);
      for (const part of parts) part.dispose();
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
      const cachedGeometries = new Set(this.geometries.values());
      for (const object of objects) {
        object.removeFromParent();
        if (!cachedGeometries.has(object.geometry)) object.geometry.dispose();
      }
    }
  }

  mesh(geometry, color, parent = this.scene) {
    const mesh = new THREE.Mesh(geometry, this.material(color));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  box(w, h, d, color, x = 0, y = 0, z = 0, parent = this.scene) {
    const key = `box:${w}:${h}:${d}`;
    if (!this.geometries.has(key)) this.geometries.set(key, new THREE.BoxGeometry(w, h, d));
    const mesh = this.mesh(this.geometries.get(key), color, parent);
    mesh.position.set(x, y, z);
    return mesh;
  }

  sphere(radius, color, parent = this.scene) {
    const key = `sphere:${radius}`;
    if (!this.geometries.has(key)) this.geometries.set(key, new THREE.SphereGeometry(radius, 16, 10));
    return this.mesh(this.geometries.get(key), color, parent);
  }

  cylinder(radius, height, color, parent = this.scene) {
    return this.mesh(new THREE.CylinderGeometry(radius, radius, height, 10), color, parent);
  }

  disc(radius, color, opacity, parent = this.scene) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.035;
    parent.add(mesh);
    return mesh;
  }

  ring(inner, outer, color, parent = this.scene) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 48), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    parent.add(mesh);
    return mesh;
  }

  groundLabel(text, color, width, depth, x, z, parent = this.scene) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.font = '900 92px Rubik, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 68);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.07, z);
    parent.add(mesh);
    return mesh;
  }

  buildCourt() {
    this.box(100, 0.25, 100, '#e1dece', 0, -0.25, 0).castShadow = false;
    this.box(18.5, 0.2, 33, '#c7805e', 0, -0.12, 0).castShadow = false;
    this.box(11, 0.04, 24, '#398674', 0, -0.015, 0).castShadow = false;
    this.box(8.2, 0.045, 24, '#4b9683', 0, -0.012, 0).castShadow = false;
    const chalk = '#f0f0da';
    const lineX = (x, length, z = 0) => this.box(0.065, 0.015, length, chalk, x, 0.02, z).castShadow = false;
    const lineZ = (z, width) => this.box(width, 0.015, 0.065, chalk, 0, 0.021, z).castShadow = false;
    for (const x of [-5.5, -4.1, 4.1, 5.5]) lineX(x, 24);
    for (const z of [-12, 12]) lineZ(z, 11.06);
    for (const z of [-6.4, 6.4]) lineZ(z, 8.2);
    lineX(0, 12.8);
    lineX(0, 0.28, 11.86);
    lineX(0, 0.28, -11.86);

    // A single line buffer makes the mesh net cheap to draw and visibly permeable.
    const vertices = [];
    for (let x = -5.6; x <= 5.61; x += 0.19) vertices.push(x, 0.07, 0, x, COURT.netHeight, 0);
    for (let y = 0.07; y <= COURT.netHeight; y += 0.14) vertices.push(-5.6, y, 0, 5.6, y, 0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#193f38', transparent: true, opacity: 0.62 })));
    this.box(11.4, 0.07, 0.07, PALETTE.cream, 0, COURT.netHeight, 0);
    for (const x of [-5.72, 5.72]) {
      const post = this.cylinder(0.075, 1.22, PALETTE.green);
      post.position.set(x, 0.61, 0);
      this.sphere(0.09, PALETTE.cream).position.set(x, 1.25, 0);
    }
    this.targetMeshes = TARGETS.map((target) => {
      const disc = this.disc(target.radius, target.color, 0.38, this.practiceProps);
      disc.position.set(target.x, 0.035, target.z);
      const border = this.ring(target.radius - 0.045, target.radius, target.color, this.practiceProps);
      border.position.set(target.x, 0.05, target.z);
      this.groundLabel(String(target.points), target.color, 1.55, 0.7, target.x, target.z, this.practiceProps);
      return disc;
    });
    this.groundLabel('R A L L Y   C L U B', '#f1d9bc', 7.5, 0.7, 0, 14.6);
    this.groundLabel('01', '#f1d9bc', 1.5, 0.8, -7.4, -13.9);
    // Asymmetric team-color edge marks echo INKWAVE's painted arena language.
    for (let index = 0; index < 7; index++) {
      const width = 0.38 + (index % 3) * 0.13;
      this.box(width, 0.035, 1.25 + (index % 2) * 0.48, index % 2 ? PALETTE.coral : PALETTE.lime,
        -7.9 + index * 0.86, 0.015, 13.25 + (index % 2) * 0.18).castShadow = false;
      this.box(width, 0.035, 1.1 + ((index + 1) % 2) * 0.55, index % 2 ? PALETTE.lavender : PALETTE.lime,
        7.9 - index * 0.86, 0.015, -13.25 - (index % 2) * 0.18).castShadow = false;
    }
    this.groundLabel('INK // SERVE', PALETTE.coral, 4.2, 0.48, -5.8, 14.2);
    this.groundLabel('WAVE // RETURN', PALETTE.lavender, 4.8, 0.48, 5.6, -14.2);
  }

  buildSurroundings() {
    const fence = [];
    const segment = (...v) => fence.push(...v);
    for (const z of [-16.5, 16.5]) {
      this.box(18.5, 0.34, 0.22, PALETTE.green, 0, 0.17, z);
      for (let x = -9.25; x <= 9.3; x += 0.37) segment(x, 0.34, z, x, 2.5, z);
      for (const y of [0.9, 1.6, 2.5]) segment(-9.25, y, z, 9.25, y, z);
    }
    for (const x of [-9.25, 9.25]) {
      this.box(0.22, 0.34, 33, PALETTE.green, x, 0.17, 0);
      for (let z = -16.5; z < 16.6; z += 0.37) segment(x, 0.34, z, x, 2.5, z);
      for (const y of [0.9, 1.6, 2.5]) segment(x, y, -16.5, x, y, 16.5);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(fence, 3));
    this.scene.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#527c68', transparent: true, opacity: 0.55 })));
    // Simple repeated trees, benches and pots frame the court without external assets.
    for (const [x, z, scale] of [[-13, -13, 1], [-14, 1, 1.1], [-13, 13, 0.85], [13, -14, 1.1], [15, -3, 0.9], [13, 11, 1]]) {
      const trunk = this.cylinder(0.2, 2.8 * scale, '#ad8b65');
      trunk.position.set(x, 1.4 * scale, z);
      const tree = this.sphere(1.6 * scale, '#7f9c65');
      tree.position.set(x, 3.8 * scale, z);
      tree.scale.y = 1.25;
    }
    for (const x of [-7.5, 7.5]) {
      this.box(0.65, 0.12, 3.7, '#e9c89c', x, 0.7, 4);
      for (const z of [2.6, 5.4]) this.box(0.55, 0.68, 0.13, PALETTE.green, x, 0.34, z);
      this.box(0.13, 0.58, 3.7, '#e9c89c', x + Math.sign(x) * 0.3, 1, 4);
    }
    for (const x of [-7.5, 7.5]) {
      this.box(0.65, 0.08, 1.2, PALETTE.cream, x, 0.06, -5);
      for (let i = 0; i < 3; i++) this.sphere(0.14, PALETTE.lime).position.set(x, 0.24, -5.3 + i * 0.3);
    }
    this.box(8.2, 1.4, 0.25, PALETTE.green, 0, 1.7, -16.5);
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 160;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = PALETTE.cream; ctx.font = '900 80px Rubik, sans-serif';
    ctx.textAlign = 'center'; ctx.fillText('INKWAVE  /  RALLY', 512, 105);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 1.15), new THREE.MeshBasicMaterial({ map: texture, transparent: true }));
    sign.position.set(0, 1.7, -16.35); this.scene.add(sign);
  }

  buildPlayer() {
    this.player = new THREE.Group();
    this.player.name = 'player-root';
    this.scene.add(this.player);
    this.torso = new THREE.Group(); this.torso.name = 'torso'; this.player.add(this.torso);
    this.box(0.6, 0.61, 0.34, PALETTE.cream, 0, 1.1, 0, this.torso);
    this.box(0.62, 0.22, 0.37, PALETTE.green, 0, 0.72, 0, this.torso);
    this.box(0.62, 0.075, 0.36, PALETTE.coral, 0, 0.86, 0, this.torso);
    const head = this.sphere(0.27, '#dca57f', this.torso); head.position.y = 1.67;
    const hair = this.sphere(0.28, PALETTE.coral, this.torso); hair.position.set(0, 1.8, 0.05); hair.scale.y = 0.72;
    for (const x of [-0.22, 0.22]) {
      const lock = this.sphere(0.14, PALETTE.coral, this.torso);
      lock.position.set(x, 1.58, 0.1); lock.scale.y = 2.1;
    }
    this.box(0.54, 0.08, 0.42, PALETTE.cream, 0, 1.77, -0.015, this.torso);
    this.box(0.49, 0.045, 0.22, PALETTE.green, 0, 1.74, -0.28, this.torso);
    for (const x of [-0.1, 0.1]) this.sphere(0.035, PALETTE.green, this.torso).position.set(x, 1.66, -0.25);
    this.legs = [-0.18, 0.18].map((x, index) => {
      const pivot = new THREE.Group(); pivot.name = `leg-${index}`; pivot.position.set(x, 0.65, 0); this.player.add(pivot);
      this.box(0.17, 0.44, 0.17, '#dca57f', 0, -0.22, 0, pivot);
      this.box(0.2, 0.18, 0.2, PALETTE.cream, 0, -0.44, 0, pivot);
      this.box(0.26, 0.16, 0.4, PALETTE.cream, 0, -0.56, -0.07, pivot);
      this.box(0.27, 0.04, 0.41, PALETTE.coral, 0, -0.64, -0.07, pivot);
      return pivot;
    });
    this.arms = [-0.39, 0.39].map((x, index) => {
      const arm = new THREE.Group(); arm.name = `arm-${index}`; arm.position.set(x, 1.29, 0); this.torso.add(arm);
      this.box(0.2, 0.19, 0.24, PALETTE.cream, 0, -0.02, 0, arm);
      this.box(0.15, 0.4, 0.16, '#dca57f', 0, -0.29, 0, arm);
      this.sphere(0.105, '#dca57f', arm).position.set(0, -0.51, 0);
      return arm;
    });
    this.racket = new THREE.Group();
    this.racket.name = 'racket';
    this.racket.position.set(0, -0.48, -0.02);
    this.racket.rotation.x = -Math.PI * 0.62;
    this.arms[1].add(this.racket);
    this.box(0.07, 0.4, 0.07, PALETTE.green, 0, 0.12, 0, this.racket);
    this.box(0.08, 0.18, 0.08, PALETTE.cream, 0, -0.02, 0, this.racket);
    const hoop = this.mesh(new THREE.TorusGeometry(0.26, 0.033, 6, 24), PALETTE.coral, this.racket);
    hoop.position.y = 0.61; hoop.scale.y = 1.28;
    const strings = [];
    for (let i = -3; i <= 3; i++) {
      const x = i * 0.065, y = i * 0.08;
      const h = Math.sqrt(Math.max(0, 1 - (x / 0.25) ** 2)) * 0.31;
      const w = Math.sqrt(Math.max(0, 1 - (y / 0.32) ** 2)) * 0.25;
      strings.push(x, 0.61 - h, 0, x, 0.61 + h, 0, -w, 0.61 + y, 0, w, 0.61 + y, 0);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(strings, 3));
    this.racket.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: PALETTE.cream })));

    this.playerAvatar = { root: this.player, torso: this.torso, legs: this.legs, arms: this.arms, racket: this.racket };
    this.bot = this.player.clone(true);
    this.bot.name = 'bot-root';
    this.bot.traverse((object) => {
      if (object.isMesh && object.material === this.material(PALETTE.coral)) object.material = this.material(PALETTE.lavender);
    });
    this.botAvatar = {
      root: this.bot,
      torso: this.bot.getObjectByName('torso'),
      legs: [this.bot.getObjectByName('leg-0'), this.bot.getObjectByName('leg-1')],
      arms: [this.bot.getObjectByName('arm-0'), this.bot.getObjectByName('arm-1')],
      racket: this.bot.getObjectByName('racket'),
    };
    this.bot.position.set(0, 0, -9);
    this.bot.rotation.y = Math.PI;
    this.scene.add(this.bot);
  }

  buildMachine() {
    this.machine = new THREE.Group(); this.machine.position.set(0, 0, -10.8); this.practiceProps.add(this.machine);
    for (const x of [-0.4, 0.4]) {
      const wheel = this.cylinder(0.17, 0.13, PALETTE.green, this.machine);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(x, 0.2, 0.15);
    }
    this.box(0.8, 0.85, 0.7, PALETTE.cream, 0, 0.7, 0, this.machine);
    this.box(0.84, 0.12, 0.74, PALETTE.coral, 0, 1.15, 0, this.machine);
    this.box(0.55, 0.45, 0.55, PALETTE.green, 0, 1.4, 0, this.machine);
    const barrel = this.cylinder(0.16, 0.65, PALETTE.coral, this.machine);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 1.7, 0.25);
    this.sphere(0.14, PALETTE.lime, this.machine).position.set(0.12, 1.75, -0.12);
  }

  resize() {
    this.width = this.container.clientWidth || window.innerWidth;
    this.height = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.frameCamera();
  }

  frameCamera() {
    const portrait = this.width / this.height < 0.9;
    const scale = portrait ? 1.4 : 1;
    this.cameraBase.set(0, 23 * scale, 29 * scale);
    // The ready panel occupies the right-hand side; a fixed camera during play keeps movement predictable.
    const offset = this.width > 1000 && this.phase === 'ready' ? 3.8 : 0;
    this.cameraTarget.set(offset, 0, portrait ? 0 : -0.3);
    this.camera.position.copy(this.cameraBase);
    this.camera.lookAt(this.cameraTarget);
    this.camera.updateProjectionMatrix();
  }

  aimAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.ground, this.point)) return null;
    return { x: this.point.x, z: this.point.z };
  }

  animateAvatar(avatar, action, { dt, elapsed, running, speed, charge = 0, charging = false, serveReady = false, winner = false, side = 1, decorativeEffects = true }) {
    action.age += dt;
    const cadence = elapsed * (9.5 + Math.min(5, speed));
    const stride = running ? Math.sin(cadence) * 0.72 : 0;
    const footPlant = running ? Math.abs(Math.sin(cadence)) : 0;
    avatar.root.scale.set(1, 1, 1);
    avatar.root.position.y = 0;
    if (decorativeEffects) {
      avatar.root.scale.set(1 + footPlant * 0.045, 1 - footPlant * 0.055, 1 + footPlant * 0.035);
      avatar.root.position.y = running ? footPlant * 0.055 : 0;
    }
    avatar.legs[0].rotation.set(stride, 0, running ? -0.13 : 0);
    avatar.legs[1].rotation.set(-stride, 0, running ? 0.13 : 0);
    avatar.torso.position.set(0, decorativeEffects && running ? footPlant * 0.075 : 0, 0);
    avatar.torso.rotation.set(running ? -0.12 : 0, 0, running ? -stride * 0.12 : 0);
    avatar.arms[0].rotation.set(-0.2 - stride * 0.72, 0, 0.16);
    avatar.arms[1].rotation.set(-0.52 + stride * 0.58, -0.25, -0.4);
    avatar.racket.rotation.set(-Math.PI * 0.62, 0, 0);

    if (charging) {
      const pulse = decorativeEffects ? 0.5 + Math.sin(elapsed * 13) * 0.5 : 0;
      if (decorativeEffects) {
        avatar.root.scale.set(1 + charge * 0.12, 1 - charge * 0.16, 1 + charge * 0.09);
        avatar.root.position.y = -charge * 0.07;
        avatar.torso.position.z = charge * 0.11;
      }
      avatar.torso.rotation.y = (-0.2 - charge * 0.72) * side;
      avatar.torso.rotation.x = charge * 0.13;
      avatar.torso.rotation.z = (-0.06 - charge * 0.1) * side;
      avatar.legs[0].rotation.x = 0.26 + charge * 0.3;
      avatar.legs[1].rotation.x = -0.18 - charge * 0.25;
      avatar.arms[0].rotation.set(-0.42 - charge * 0.28, 0, 0.32 * side);
      avatar.arms[1].rotation.x = -0.72 - charge * 1.05;
      avatar.arms[1].rotation.y = (-0.35 - charge * 1.05) * side;
      avatar.arms[1].rotation.z = (-0.48 - charge * 0.95) * side;
      avatar.racket.rotation.set(-1.75 - charge * 0.5, 0, (-0.2 - charge * 0.72) * side);
      avatar.racket.scale.setScalar(decorativeEffects ? 1 + pulse * charge * 0.045 : 1);
    } else if (serveReady) {
      if (decorativeEffects) {
        avatar.root.scale.set(1.07, 0.92, 1.05);
        avatar.root.position.y = -0.035;
      }
      avatar.torso.rotation.set(0.1, -0.3 * side, -0.08 * side);
      avatar.legs[0].rotation.x = 0.32;
      avatar.legs[1].rotation.x = -0.26;
      avatar.arms[0].rotation.x = -1.05;
      avatar.arms[1].rotation.set(-1.22, -0.62 * side, -0.82 * side);
      avatar.racket.rotation.set(-1.62, 0, -0.28 * side);
    }

    if (action.type === 'toss' && action.age < 0.42) {
      const p = Math.min(1, action.age / 0.4);
      const reach = Math.sin(p * Math.PI * 0.58);
      if (decorativeEffects) {
        avatar.root.scale.set(1.05 - p * 0.06, 0.9 + p * 0.28, 1.04 - p * 0.05);
        avatar.root.position.y = p * 0.08;
      }
      avatar.arms[0].rotation.x = -0.55 - reach * 2.25;
      avatar.arms[0].rotation.z = 0.3 * side;
      avatar.arms[1].rotation.x = -1.05 - p * 1.42;
      avatar.arms[1].rotation.y = -0.38 * side;
      avatar.arms[1].rotation.z = (-0.4 - p * 0.78) * side;
      avatar.torso.rotation.set(-0.22 * p, 0.18 * side, -0.09 * side);
      avatar.racket.rotation.set(-2.18, 0, -0.38 * side);
    } else if (action.type === 'serve' && action.age < 0.78) {
      const p = Math.min(1, action.age / 0.72);
      const strike = Math.sin(Math.min(1, p * 1.8) * Math.PI);
      const leap = Math.sin(Math.min(1, p / 0.72) * Math.PI);
      const landing = Math.max(0, (p - 0.72) / 0.28);
      if (decorativeEffects) {
        avatar.root.position.y = leap * 0.34 - landing * 0.07;
        avatar.root.scale.set(0.92 + strike * 0.1 + landing * 0.17, 1.18 - strike * 0.08 - landing * 0.26, 0.94 + landing * 0.12);
      }
      avatar.torso.rotation.x = -0.32 + p * 0.72;
      avatar.torso.rotation.y = (0.22 - p * 0.48) * side;
      avatar.torso.rotation.z = -0.14 * side;
      avatar.arms[0].rotation.x = -2.42 + p * 1.85;
      avatar.arms[1].rotation.x = -2.85 + strike * 3.15;
      avatar.arms[1].rotation.y = (-0.36 + p * 1.25) * side;
      avatar.arms[1].rotation.z = (-1.05 + strike * 1.92) * side;
      avatar.racket.rotation.set(-2.3 + p * 2.15, 0, (-0.45 + strike * 1.1) * side);
      avatar.legs[0].rotation.x = -leap * 0.65 + landing * 0.48;
      avatar.legs[1].rotation.x = leap * 0.48 - landing * 0.35;
    } else if (action.type === 'hit' && action.age < 0.72) {
      const duration = 0.48 + (1 - action.quality) * 0.08;
      const p = Math.min(1, action.age / duration);
      const snap = Math.sin(Math.min(1, p * 1.8) * Math.PI);
      const settle = Math.sin(p * Math.PI);
      const strokeSide = action.stroke === 'backhand' ? -side : side;
      const power = 0.95 + action.charge * 0.48;
      if (decorativeEffects) {
        avatar.root.scale.set(1 + snap * 0.14, 1 - snap * 0.13, 1 + snap * 0.09);
        avatar.root.position.y = snap * 0.11;
        avatar.torso.position.z = settle * 0.15;
      }
      avatar.torso.rotation.y = (-0.9 + p * 1.82) * strokeSide * power;
      avatar.torso.rotation.x = -0.18 + settle * 0.34;
      avatar.torso.rotation.z = -0.2 * strokeSide * settle;
      avatar.arms[1].rotation.x = -0.82 - snap * 1.72 * power;
      avatar.arms[1].rotation.y = (-1.65 + p * 3.1) * strokeSide;
      avatar.arms[1].rotation.z = (-0.86 + snap * 2.12) * strokeSide;
      avatar.arms[0].rotation.set(-0.38 - settle * 0.65, 0, 0.52 * strokeSide);
      avatar.racket.rotation.set(-1.95 + snap * 0.85, 0, (-0.88 + p * 1.95) * strokeSide);
    }

    if (winner && action.type === 'victory' && action.age < 1.9) {
      const p = action.age;
      const jump = Math.max(0, Math.sin(Math.min(1, p / 1.45) * Math.PI * 2.35)) * Math.max(0, 1 - p / 2.05);
      const victorySquash = Math.max(0, Math.sin(Math.min(1, p / 0.24) * Math.PI));
      avatar.root.position.y = jump * 0.42 - victorySquash * 0.06;
      avatar.root.scale.set(1 + victorySquash * 0.15, 1 - victorySquash * 0.18 + jump * 0.12, 1 + victorySquash * 0.12);
      avatar.torso.position.y += jump * 0.14;
      avatar.legs[0].rotation.x = -jump * 0.95;
      avatar.legs[1].rotation.x = jump * 0.82;
      avatar.arms[0].rotation.set(-2.75, 0, 0.68);
      avatar.arms[1].rotation.set(-2.7, 0, -0.7);
      avatar.racket.rotation.set(-0.28, 0, Math.sin(p * 9) * 0.28);
      avatar.torso.rotation.y = Math.sin(p * 6.2) * 0.42;
      avatar.torso.rotation.z = Math.sin(p * 9) * 0.12;
    }
    if (!charging || !decorativeEffects) avatar.racket.scale.setScalar(1);
  }

  notify(event) {
    if (!event) return;
    if (event.type === 'reset' || event.type === 'start') {
      this.effects?.clear();
      this.winner = null;
      this.cameraImpact.age = this.cameraImpact.duration;
      for (const action of Object.values(this.actorActions)) Object.assign(action, { type: '', age: 9, stroke: 'forehand', quality: 1, charge: 0 });
      return;
    }
    if (event.type === 'hit' || event.type === 'swing-miss') this.swingTime = 0;
    const actorName = event.actor || (event.type === 'hit' || event.type === 'swing-miss' ? 'player' : '');
    const actor = actorName && this.actorActions[actorName];
    if (actor && ['hit', 'serve', 'serve-toss'].includes(event.type)) {
      Object.assign(actor, {
        type: event.type === 'serve-toss' ? 'toss' : event.type,
        age: 0,
        stroke: event.stroke || 'forehand',
        quality: Number.isFinite(event.quality) ? event.quality : 1,
        charge: Number.isFinite(event.charge) ? event.charge : 0.65,
      });
    }
    if (event.type === 'finish' && this.actorActions[event.winner]) {
      this.winner = event.winner;
      Object.assign(this.actorActions[event.winner], { type: 'victory', age: 0 });
    }
    if (this.effects?.enabled && ['hit', 'serve', 'bounce'].includes(event.type)) {
      this.cameraImpact.age = 0;
      this.cameraImpact.duration = event.type === 'bounce' ? 0.13 : 0.2;
      this.cameraImpact.strength = event.type === 'serve' ? 0.18 : event.type === 'hit' ? 0.14 : 0.075;
      this.cameraImpact.direction = event.actor === 'bot' ? -1 : 1;
    }
    this.effects?.notify(actorName && !event.actor ? { ...event, actor: actorName } : event);
  }

  render(state, { dt = 0, charge = 0, charging = false, aim, predictedAim, canHit = false, canServe = false, mode = state.mode || 'practice', effects = true, reducedMotion = false } = {}) {
    if (state.phase !== this.phase) { this.phase = state.phase; this.frameCamera(); }
    const decorativeEffects = effects && !reducedMotion;
    this.effects.setEnabled(decorativeEffects);
    this.visualTime += Math.max(0, dt);
    this.camera.position.copy(this.cameraBase);
    this.camera.lookAt(this.cameraTarget);
    const duel = mode === 'duel';
    this.practiceProps.visible = !duel;
    this.bot.visible = duel;
    const player = state.player, ball = state.ball;
    const distance = Math.hypot(player.x - this.lastPlayer.x, player.z - this.lastPlayer.z);
    const running = dt > 0 && distance / dt > 0.3;
    const playerSpeed = dt > 0 ? distance / dt : 0;
    this.lastPlayer.x = player.x; this.lastPlayer.z = player.z;
    this.player.position.set(player.x, 0, player.z);
    if (aim) this.player.rotation.y = Math.atan2(-(aim.x - player.x), -(aim.z - player.z)) * 0.32;
    this.swingTime += dt;
    this.animateAvatar(this.playerAvatar, this.actorActions.player, {
      dt, elapsed: this.visualTime, running, speed: playerSpeed, charge, charging,
      serveReady: duel && canServe,
      winner: decorativeEffects && this.winner === 'player', side: 1, decorativeEffects,
    });
    if (duel && state.bot) {
      const botDistance = Math.hypot(state.bot.x - this.lastBot.x, state.bot.z - this.lastBot.z);
      const botSpeed = dt > 0 ? botDistance / dt : 0;
      this.bot.position.set(state.bot.x, 0, state.bot.z);
      const targetX = ball?.active ? ball.x : player.x;
      const targetZ = ball?.active ? ball.z : player.z;
      this.bot.rotation.y = Math.PI - Math.atan2(targetX - state.bot.x, targetZ - state.bot.z) * 0.32;
      this.animateAvatar(this.botAvatar, this.actorActions.bot, {
        dt, elapsed: this.visualTime + 0.31, running: dt > 0 && botSpeed > 0.3, speed: botSpeed,
        winner: decorativeEffects && this.winner === 'bot', side: -1, decorativeEffects,
      });
      this.lastBot.x = state.bot.x; this.lastBot.z = state.bot.z;
    }
    this.ball.visible = !!ball.active;
    this.ballShadow.visible = !!ball.active;
    if (ball.active) {
      this.ball.position.set(ball.x, ball.y, ball.z);
      this.ballVelocity.set(ball.vx || 0, ball.vy || 0, ball.vz || 0);
      const ballSpeed = this.ballVelocity.length();
      const stretch = decorativeEffects ? Math.min(0.48, ballSpeed * 0.021) : 0;
      this.ball.scale.set(1 - stretch * 0.28, 1 + stretch, 1 - stretch * 0.28);
      if (ballSpeed > 0.01) {
        this.ballDirection.copy(this.ballVelocity).normalize();
        this.ball.quaternion.setFromUnitVectors(UP, this.ballDirection);
        this.ball.rotateY(state.elapsed * 5);
      }
      this.ball.material.color.set(ball.lastHitter === 'bot' ? PALETTE.lavender : ball.lastHitter === 'player' ? PALETTE.coral : PALETTE.lime);
      this.ball.material.emissive.set(ball.lastHitter === 'bot' ? '#30285d' : ball.lastHitter === 'player' ? '#652116' : '#39420d');
      this.ball.material.emissiveIntensity = decorativeEffects ? 0.34 : 0.12;
      this.ballShadow.position.set(ball.x, 0.035, ball.z);
      const scale = 1 + ball.y * 0.12;
      this.ballShadow.scale.setScalar(scale);
      this.ballShadow.material.opacity = Math.max(0.08, 0.3 - ball.y * 0.04);
    } else {
      this.ball.scale.setScalar(1);
      this.ball.quaternion.identity();
    }
    const displayAim = predictedAim || aim;
    this.aimMarker.visible = !!displayAim;
    if (displayAim) this.aimMarker.position.set(displayAim.x, 0.07, displayAim.z);
    this.playerRing.position.set(player.x, 0.04, player.z);
    const activeContact = canHit || canServe;
    this.playerRing.material.color.set(activeContact ? PALETTE.lime : PALETTE.cream);
    this.playerRing.scale.setScalar(activeContact ? 1.3 : 1);
    this.landingMarker.visible = !!ball.active && ball.state === 'incoming';
    if (this.landingMarker.visible) {
      const time = (ball.vy + Math.sqrt(ball.vy * ball.vy + 19.62 * Math.max(0, ball.y - COURT.ballRadius))) / 9.81;
      this.landingMarker.position.set(ball.x + ball.vx * time, 0.055, ball.z + ball.vz * time);
    }
    this.scene.updateMatrixWorld(true);
    this.racketTip.player.set(0, 0.61, 0);
    this.playerAvatar.racket.localToWorld(this.racketTip.player);
    if (duel) {
      this.racketTip.bot.set(0, 0.61, 0);
      this.botAvatar.racket.localToWorld(this.racketTip.bot);
    }
    this.effects.update(dt, ball, this.racketTip, {
      charge, charging, player: state.player, bot: state.bot, camera: this.camera,
      playing: state.phase === 'playing',
    });
    if (decorativeEffects && state.phase === 'playing' && this.cameraImpact.age < this.cameraImpact.duration) {
      this.cameraImpact.age += dt;
      const impactProgress = Math.min(1, this.cameraImpact.age / this.cameraImpact.duration);
      const impact = Math.sin(impactProgress * Math.PI * 3) * (1 - impactProgress) * this.cameraImpact.strength;
      this.camera.position.x += impact * this.cameraImpact.direction;
      this.camera.position.y += Math.abs(impact) * 0.34;
      this.camera.lookAt(this.cameraTarget);
    } else if (!decorativeEffects || state.phase !== 'playing') {
      this.cameraImpact.age = this.cameraImpact.duration;
    }
    this.renderer.render(this.scene, this.camera);
  }

  isAnimating() {
    if (this.phase !== 'finished' || !this.effects.enabled) return false;
    const winnerAction = this.winner && this.actorActions[this.winner];
    return !!(winnerAction && winnerAction.age < 1.9) || this.effects.isAnimating();
  }

  effectDiagnostics() { return this.effects.diagnostics(); }

  settleEffects() {
    this.effects.clear();
    this.winner = null;
    this.cameraImpact.age = this.cameraImpact.duration;
    this.camera.position.copy(this.cameraBase);
    this.camera.lookAt(this.cameraTarget);
    for (const action of Object.values(this.actorActions)) action.age = 9;
  }

  dispose() {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    for (const geometry of this.geometries.values()) geometries.add(geometry);
    this.scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
        materials.add(material);
        if (material.map) textures.add(material.map);
      }
    });
    for (const resource of [...geometries, ...materials, ...textures]) resource.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
