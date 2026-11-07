import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { bounds, ceilingHeightAt, itemClearances, itemCorners, openingsForWall, roomAt, roomWalls } from '../geometry';
import type { Item, Project } from '../model';
import { moveItem } from '../placement';
import { store, type CameraMode } from '../state';
import { formatLength } from '../units';
import { clearOverlay } from './overlay';
import { resolvePick } from './pick';
import { configureSunShadow } from './sun';
import { walkCollides, walkStart } from './walk';
import { buildHouse, buildItemGroup, itemBaseY, placeItemGroup } from './scene';

const EYE = 1.62;
const MAX_LIGHTS = 8;

export class Viewer {
  readonly el: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  private scene = new THREE.Scene();
  private persp: THREE.PerspectiveCamera;
  private ortho: THREE.OrthographicCamera;
  private orbitP: OrbitControls;
  private orbitO: OrbitControls;
  private mode: CameraMode = 'orbit';
  private structure: THREE.Group | null = null;
  private walls: THREE.Mesh[] = [];
  private ceilings: THREE.Object3D[] = [];
  private items = new Map<string, { obj: THREE.Group; sig: string }>();
  private itemsGroup = new THREE.Group();
  private overlay = new THREE.Group();
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private ground: THREE.Mesh;
  private structureSig = '';
  private needsRebuild = true;
  private raycaster = new THREE.Raycaster();
  private selBox = new THREE.BoxHelper(new THREE.Object3D(), 0x2f80ed);
  private drag: { id: string; plane: THREE.Plane; offset: THREE.Vector3; moved: boolean; start: { x: number; y: number } } | null = null;
  private pointerDown: { x: number; y: number; time: number } | null = null;
  // walk mode
  private walk = { yaw: 0, pitch: 0, keys: new Set<string>(), joy: { x: 0, y: 0 }, lookId: -1, lookLast: { x: 0, y: 0 }, pos: new THREE.Vector3(), floorY: 0 };
  private joystickEl: HTMLElement;
  private walkHelp: HTMLElement;
  private clock = new THREE.Timer();
  private edgeCache = new WeakMap<THREE.BufferGeometry, THREE.EdgesGeometry>();
  private visible = true;
  private fittedOnce = false;
  private pendingWalkPoint: { x: number; z: number } | null = null;
  private lightPool: THREE.PointLight[] = [];
  private lightKey = '';
  private lightsDirty = true;

  constructor(container: HTMLElement) {
    this.el = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.classList.add('viewer-canvas');

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'viewer-labels';
    container.appendChild(this.labels.domElement);

    this.persp = new THREE.PerspectiveCamera(55, 1, 0.05, 500);
    this.persp.position.set(8, 9, 12);
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, -200, 500);

    this.orbitP = new OrbitControls(this.persp, this.renderer.domElement);
    this.orbitP.enableDamping = true;
    this.orbitP.maxPolarAngle = Math.PI / 2 - 0.02;
    this.orbitO = new OrbitControls(this.ortho, this.renderer.domElement);
    this.orbitO.enableDamping = true;
    this.orbitO.enabled = false;
    for (const c of [this.orbitP, this.orbitO]) c.addEventListener('change', () => this.updateCutaway());

    this.scene.background = new THREE.Color('#dfe9f3');
    this.hemi = new THREE.HemisphereLight('#ffffff', '#b9ab95', 0.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff4e0', 1.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    configureSunShadow(this.sun, 25);
    this.scene.add(this.sun, this.sun.target);

    this.ground = new THREE.Mesh(new THREE.CircleGeometry(150, 48), new THREE.MeshStandardMaterial({ color: '#c5d3b4', roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.01;
    this.ground.receiveShadow = true;
    this.ground.userData = { type: 'ground' };
    this.scene.add(this.ground);
    const grid = new THREE.GridHelper(60, 60, 0x9fb28f, 0xb4c3a5);
    grid.position.y = -0.005;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    this.scene.add(grid);

    this.scene.add(this.itemsGroup, this.overlay);
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new THREE.PointLight('#ffffff', 0, 5, 2);
      l.visible = true;
      this.lightPool.push(l);
      this.scene.add(l);
    }
    this.selBox.visible = false;
    this.scene.add(this.selBox);

    this.joystickEl = document.createElement('div');
    this.joystickEl.className = 'joystick hidden';
    this.joystickEl.innerHTML = '<div class="joy-knob"></div>';
    container.appendChild(this.joystickEl);
    this.walkHelp = document.createElement('div');
    this.walkHelp.className = 'walk-help hidden';
    this.walkHelp.innerHTML = 'Walk mode · <b>WASD / arrows</b> move · <b>drag</b> or click to look · <b>Shift</b> run · <b>Esc</b> exit';
    container.appendChild(this.walkHelp);

    this.bindEvents();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    store.subscribe((r) => {
      if (r === 'ui') this.updateSelection();
      else this.needsRebuild = true;
    });
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setVisible(v: boolean) {
    this.visible = v;
    if (v) this.resize();
  }

  // -------------------------------------------------------------------------
  // Building

  private rebuild() {
    const p = store.project;
    const sig = JSON.stringify({ r: p.rooms, o: p.openings, s: p.settings.renderStyle });
    if (sig !== this.structureSig) {
      this.structureSig = sig;
      if (this.structure) {
        this.scene.remove(this.structure);
        disposeTree(this.structure);
      }
      const built = buildHouse({ ...p, items: [] }, () => (this.needsRebuild = true, this.structureSig = ''));
      this.structure = built.group;
      this.walls = built.walls;
      this.ceilings = built.ceilings;
      this.scene.add(this.structure);
      if (p.settings.renderStyle === 'drawing') this.applyDrawingStyle(this.structure);
      // structure change may affect ceiling-mounted item heights
      for (const v of this.items.values()) v.sig = '';
    }
    const seen = new Set<string>();
    for (const it of p.items) {
      seen.add(it.id);
      const sig = itemSignature(it, p);
      const cur = this.items.get(it.id);
      if (cur && cur.sig === sig) {
        placeItemGroup(p, it, cur.obj);
        continue;
      }
      if (cur) {
        this.itemsGroup.remove(cur.obj);
        disposeTree(cur.obj);
      }
      const obj = buildItemGroup(p, it, () => {
        const e = this.items.get(it.id);
        if (e) e.sig = '';
        this.needsRebuild = true;
      });
      if (p.settings.renderStyle === 'drawing') this.applyDrawingStyle(obj);
      this.itemsGroup.add(obj);
      this.items.set(it.id, { obj, sig });
    }
    for (const [id, v] of this.items) {
      if (!seen.has(id)) {
        this.itemsGroup.remove(v.obj);
        disposeTree(v.obj);
        this.items.delete(id);
      }
    }
    this.lightsDirty = true;
    this.applyEnvironment();
    if (!this.fittedOnce && p.rooms.length) {
      this.fittedOnce = true;
      this.zoomToFit();
    }
    this.updateCeilings();
    this.updateCutaway();
    this.updateSelection();
  }

  private applyDrawingStyle(root: THREE.Object3D) {
    const white = new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const lineM = new THREE.LineBasicMaterial({ color: '#2b2f36' });
    white.userData.cached = true;
    lineM.userData.cached = true;
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.visible) meshes.push(m);
    });
    for (const m of meshes) {
      const orig = m.material as THREE.MeshStandardMaterial;
      if ((orig as any).visible === false) continue;
      const transparent = orig.transparent && orig.opacity < 0.5;
      m.material = transparent
        ? new THREE.MeshBasicMaterial({ color: '#dcecf5', transparent: true, opacity: 0.3 })
        : m.userData.type === 'wall'
          ? Object.assign(white.clone(), { userData: {} })
          : white;
      m.castShadow = false;
      let e = this.edgeCache.get(m.geometry);
      if (!e) {
        e = new THREE.EdgesGeometry(m.geometry, 25);
        if ((m.geometry as any).__shared) (e as any).__shared = true;
        this.edgeCache.set(m.geometry, e);
      }
      const lines = new THREE.LineSegments(e, lineM);
      lines.userData.edges = true;
      lines.raycast = () => {};
      m.add(lines);
    }
  }

  private applyEnvironment() {
    const s = store.project.settings;
    const drawing = s.renderStyle === 'drawing';
    const t = s.timeOfDay;
    const dayFactor = Math.max(0, Math.sin(((t - 6) / 12) * Math.PI)); // 0 at 6/18h, 1 at noon
    const az = ((t - 6) / 12) * Math.PI; // east -> west
    const el = Math.max(0.05, dayFactor) * (Math.PI / 2.4);
    const c = this.houseCenter();
    configureSunShadow(this.sun, c.size * 0.75 + 4);
    const dist = 40;
    this.sun.position.set(c.x + Math.cos(az) * Math.cos(el) * dist, Math.sin(el) * dist, c.z + Math.sin(el + 0.6) * 0.5 * dist * 0.4 + 10);
    this.sun.target.position.set(c.x, 0, c.z);
    const warm = new THREE.Color('#ffb46b').lerp(new THREE.Color('#fff4e0'), Math.min(1, dayFactor * 2));
    this.sun.color.copy(warm);
    this.sun.intensity = drawing ? 0.6 : s.sunIntensity * Math.max(0.0, dayFactor) * 1.5;
    this.sun.castShadow = !drawing;
    this.hemi.intensity = drawing ? 2.4 : s.ambientIntensity * (0.2 + dayFactor * 0.6);
    const day = new THREE.Color('#cfe0f0');
    const night = new THREE.Color('#141a2b');
    const sky = drawing ? new THREE.Color('#ffffff') : night.clone().lerp(day, Math.min(1, dayFactor * 1.6));
    (this.scene.background as THREE.Color).copy(sky);
    this.ground.visible = !drawing;
  }

  private houseCenter() {
    const pts = store.project.rooms.flatMap((r) => r.points);
    if (!pts.length) return { x: 0, z: 0, size: 10 };
    const b = bounds(pts);
    return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, size: Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 3) };
  }

  private updateCeilings() {
    const show = this.mode === 'walk' || store.project.settings.showCeilings;
    for (const c of this.ceilings) c.visible = show;
  }

  /** Fade walls that sit between the camera and the room interior (dollhouse cutaway). */
  private updateCutaway() {
    const s = store.project.settings;
    const cam = this.camera();
    const on = s.cutawayWalls && this.mode !== 'walk' && this.mode !== 'top';
    const camPos = cam.position;
    const dirV = new THREE.Vector3();
    cam.getWorldDirection(dirV);
    const fadedWalls = new Set<string>();
    for (const w of this.walls) {
      const m = w.material as THREE.MeshStandardMaterial;
      let fade = false;
      if (on) {
        const n = w.userData.inward as { x: number; z: number };
        // For ortho cameras use the view direction; for perspective use camera position relative to wall
        w.geometry.computeBoundingSphere();
        const c = w.geometry.boundingSphere!.center;
        const facing = this.mode === 'orbit' ? (camPos.x - c.x) * n.x + (camPos.z - c.z) * n.z : -(dirV.x * n.x + dirV.z * n.z);
        fade = facing < -0.01;
        if (w.userData.exterior) fade = facing < -0.01;
      }
      const wantOpacity = fade ? 0.12 : 1;
      if (m.opacity !== wantOpacity) {
        m.transparent = fade;
        m.opacity = wantOpacity;
        m.depthWrite = !fade;
        m.needsUpdate = true;
        w.castShadow = !fade;
        for (const ch of w.children) ch.visible = !fade;
      }
      if (fade && !w.userData.exterior) fadedWalls.add(`${w.userData.roomId}:${w.userData.index}`);
    }
    // doors/windows in a cut-away wall would float in mid-air and block clicks: hide them too
    this.structure?.children.forEach((o) => {
      if (o.userData.type !== 'opening') return;
      const op = store.opening(o.userData.id);
      o.visible = !op || !fadedWalls.has(`${op.roomId}:${op.wallIndex}`);
    });
  }

  // -------------------------------------------------------------------------
  // Selection / overlays

  private updateSelection() {
    clearOverlay(this.overlay);
    const sel = store.ui.selection;
    const p = store.project;
    this.selBox.visible = false;
    const units = p.settings.units;
    if (sel?.type === 'item' && this.mode !== 'walk') {
      const entry = this.items.get(sel.id);
      const it = store.item(sel.id);
      if (entry && it) {
        this.selBox.setFromObject(entry.obj);
        this.selBox.visible = true;
        if (p.settings.showClearances) this.drawClearances(it);
        this.label(new THREE.Vector3(it.x, itemBaseY(p, it) + it.height + 0.12, it.z), `${it.name}: ${formatLength(it.width, units)} × ${formatLength(it.depth, units)} × ${formatLength(it.height, units)}`, 'dim-label strong');
      }
    }
    if (p.settings.showDimensions && this.mode !== 'walk') this.drawWallDims();
  }

  private label(pos: THREE.Vector3, text: string, cls = 'dim-label') {
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = text;
    const obj = new CSS2DObject(div);
    obj.position.copy(pos);
    this.overlay.add(obj);
  }

  private line(a: THREE.Vector3, b: THREE.Vector3, color = 0xe2574c) {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false }));
    l.renderOrder = 10;
    this.overlay.add(l);
    // end ticks
    for (const p of [a, b]) {
      const t = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      t.position.copy(p);
      t.renderOrder = 10;
      this.overlay.add(t);
    }
  }

  private drawClearances(it: Item) {
    const p = store.project;
    const units = p.settings.units;
    const y = itemBaseY(p, it) + Math.min(it.height / 2, 0.5);
    for (const c of itemClearances(p, it)) {
      if (c.distance < 0.005) continue;
      const a = new THREE.Vector3(c.from.x, y, c.from.z);
      const b = new THREE.Vector3(c.to.x, y, c.to.z);
      this.line(a, b);
      this.label(a.clone().lerp(b, 0.5), formatLength(c.distance, units));
    }
    // vertical: floor clearance & ceiling clearance
    const room = roomAt(p, { x: it.x, z: it.z });
    if (room) {
      const base = itemBaseY(p, it);
      const ceil = room.elevation + ceilingHeightAt(room, { x: it.x, z: it.z });
      const corner = itemCorners(it)[2];
      if (base - room.elevation > 0.05) {
        const a = new THREE.Vector3(corner.x, room.elevation, corner.z);
        const b = new THREE.Vector3(corner.x, base, corner.z);
        this.line(a, b, 0x2f80ed);
        this.label(a.clone().lerp(b, 0.5), `↑ ${formatLength(base - room.elevation, units)}`, 'dim-label blue');
      }
      const top = base + it.height;
      if (ceil - top > 0.05) {
        const a = new THREE.Vector3(corner.x, top, corner.z);
        const b = new THREE.Vector3(corner.x, ceil, corner.z);
        this.line(a, b, 0x2f80ed);
        this.label(a.clone().lerp(b, 0.5), `↕ ${formatLength(ceil - top, units)}`, 'dim-label blue');
      }
    }
  }

  private drawWallDims() {
    const p = store.project;
    const units = p.settings.units;
    const sel = store.ui.selection;
    const seen = new Set<string>();
    for (const r of p.rooms) {
      const selected = (sel?.type === 'room' && sel.id === r.id) || (sel?.type === 'wall' && sel.roomId === r.id);
      if (!selected && this.mode === 'orbit') continue;
      for (const w of roomWalls(r)) {
        const mid = { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 };
        const key = `${Math.round(mid.x * 20)},${Math.round(mid.z * 20)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const y = r.elevation + Math.min(ceilingHeightAt(r, mid), r.wallHeight) + 0.15;
        this.label(new THREE.Vector3(mid.x, y, mid.z), formatLength(w.length, units), 'dim-label wall');
        for (const wo of openingsForWall(p, w)) {
          if (wo.opening.roomId !== r.id || wo.opening.wallIndex !== w.index) continue;
          const u = (wo.u0 + wo.u1) / 2;
          const pt = { x: w.a.x + w.dir.x * u, z: w.a.z + w.dir.z * u };
          this.label(new THREE.Vector3(pt.x, r.elevation + wo.opening.sill + wo.opening.height + 0.1, pt.z), formatLength(wo.opening.width, units), 'dim-label small');
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Cameras

  camera(): THREE.Camera {
    return this.mode === 'orbit' || this.mode === 'walk' ? this.persp : this.ortho;
  }

  setMode(mode: CameraMode) {
    const prev = this.mode;
    this.mode = mode;
    const c = this.houseCenter();
    const ortho = mode === 'iso' || mode === 'top' || mode === 'front' || mode === 'side';
    this.orbitP.enabled = mode === 'orbit';
    this.orbitO.enabled = ortho;
    if (prev === 'walk' && mode !== 'walk') this.exitWalk();
    if (mode === 'walk') this.enterWalk();
    if (ortho) {
      const D = 60;
      const offsets: Record<string, THREE.Vector3> = {
        iso: new THREE.Vector3(1, 0.82, 1).normalize().multiplyScalar(D),
        top: new THREE.Vector3(0, D, 0.001),
        front: new THREE.Vector3(0, 1.2, D),
        side: new THREE.Vector3(D, 1.2, 0),
      };
      const target = new THREE.Vector3(c.x, mode === 'top' ? 0 : 1.2, c.z);
      this.ortho.position.copy(target).add(offsets[mode]);
      this.orbitO.target.copy(target);
      this.orbitO.maxPolarAngle = mode === 'top' ? 0.001 : Math.PI / 2;
      this.orbitO.minPolarAngle = 0;
      this.orbitO.enableRotate = true;
      this.fitOrtho(c.size * 1.25);
      this.orbitO.update();
    } else if (mode === 'orbit' && prev !== 'orbit') {
      this.orbitP.target.set(c.x, 1, c.z);
      if (prev === 'walk' || this.persp.position.distanceTo(this.orbitP.target) < 2) this.persp.position.set(c.x + c.size * 0.9, c.size * 0.9 + 3, c.z + c.size * 1.1);
      this.orbitP.update();
    }
    this.updateCeilings();
    this.updateCutaway();
    this.updateSelection();
  }

  private fitOrtho(size: number) {
    const aspect = this.el.clientWidth / Math.max(1, this.el.clientHeight);
    const h = size / 2;
    this.ortho.left = -h * Math.max(1, aspect);
    this.ortho.right = h * Math.max(1, aspect);
    this.ortho.top = h / Math.min(1, aspect);
    this.ortho.bottom = -h / Math.min(1, aspect);
    this.ortho.zoom = 1;
    this.ortho.updateProjectionMatrix();
  }

  /** Rotate the current view around its target by degrees. */
  rotateView(deg: number) {
    const ctrl = this.mode === 'orbit' ? this.orbitP : this.orbitO;
    if (this.mode === 'walk') {
      this.walk.yaw += (deg * Math.PI) / 180;
      return;
    }
    const cam = ctrl.object;
    const off = cam.position.clone().sub(ctrl.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), (deg * Math.PI) / 180);
    cam.position.copy(ctrl.target).add(off);
    ctrl.update();
    this.updateCutaway();
  }

  zoomToFit() {
    const c = this.houseCenter();
    if (this.mode === 'orbit') {
      this.orbitP.target.set(c.x, 1, c.z);
      this.persp.position.set(c.x + c.size * 0.6, c.size * 1.0 + 3, c.z + c.size * 1.15);
      this.orbitP.update();
    } else if (this.mode !== 'walk') this.setMode(this.mode);
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera());
    return this.renderer.domElement.toDataURL('image/png');
  }

  // -------------------------------------------------------------------------
  // Walk mode

  private enterWalk() {
    const start = walkStart(store.project, this.pendingWalkPoint ? { point: this.pendingWalkPoint } : { room: store.selectedRoom() });
    this.pendingWalkPoint = null;
    this.walk.pos.set(start.pos.x, 0, start.pos.z);
    this.walk.pitch = -0.05;
    this.walk.yaw = start.yaw;
    this.walk.floorY = start.floorY;
    this.joystickEl.classList.remove('hidden');
    this.walkHelp.classList.remove('hidden');
    this.persp.fov = 70;
    this.persp.updateProjectionMatrix();
  }

  private exitWalk() {
    this.joystickEl.classList.add('hidden');
    this.walkHelp.classList.add('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    this.persp.fov = 55;
    this.persp.updateProjectionMatrix();
  }

  private collides(p: { x: number; z: number }): boolean {
    return walkCollides(store.project, p);
  }

  private updateWalk(dt: number) {
    const w = this.walk;
    const k = w.keys;
    let fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const turn = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
    w.yaw -= turn * dt * 1.8;
    fwd += -w.joy.y;
    strafe += w.joy.x;
    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 3.2 : 1.5) * dt;
    const sin = Math.sin(w.yaw);
    const cos = Math.cos(w.yaw);
    const dx = (-sin * fwd + cos * strafe) * speed;
    const dz = (-cos * fwd - sin * strafe) * speed;
    const nx = { x: w.pos.x + dx, z: w.pos.z };
    if (!this.collides(nx)) w.pos.x = nx.x;
    const nz = { x: w.pos.x, z: w.pos.z + dz };
    if (!this.collides(nz)) w.pos.z = nz.z;
    const room = roomAt(store.project, { x: w.pos.x, z: w.pos.z });
    const targetY = room?.elevation ?? 0;
    w.floorY += (targetY - w.floorY) * Math.min(1, dt * 8);
    this.persp.position.set(w.pos.x, w.floorY + EYE, w.pos.z);
    const look = new THREE.Euler(w.pitch, w.yaw, 0, 'YXZ');
    this.persp.quaternion.setFromEuler(look);
  }

  // -------------------------------------------------------------------------
  // Events

  private ndc(e: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private pick(e: { clientX: number; clientY: number }) {
    this.raycaster.setFromCamera(this.ndc(e), this.camera());
    const targets: THREE.Object3D[] = [this.itemsGroup];
    if (this.structure) targets.push(this.structure);
    return resolvePick(this.raycaster.intersectObjects(targets, true));
  }

  private bindEvents() {
    const cv = this.renderer.domElement;
    cv.addEventListener('pointerdown', (e) => {
      if (this.mode === 'walk') {
        // left half bottom area handled by joystick; elsewhere look
        this.walk.lookId = e.pointerId;
        this.walk.lookLast = { x: e.clientX, y: e.clientY };
        cv.setPointerCapture(e.pointerId);
        if (e.pointerType === 'mouse' && !document.pointerLockElement) cv.requestPointerLock?.();
        return;
      }
      this.pointerDown = { x: e.clientX, y: e.clientY, time: performance.now() };
      const hit = this.pick(e);
      if (hit?.data.type === 'item') {
        const it = store.item(hit.data.id);
        if (it) store.select({ type: 'item', id: it.id });
        // press-and-drag moves furniture right away (no need to select first)
        if (it && !it.locked) {
          const base = itemBaseY(store.project, it);
          const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -base);
          const pt = new THREE.Vector3();
          this.raycaster.setFromCamera(this.ndc(e), this.camera());
          this.raycaster.ray.intersectPlane(plane, pt);
          this.drag = { id: it.id, plane, offset: new THREE.Vector3(it.x - pt.x, 0, it.z - pt.z), moved: false, start: { x: e.clientX, y: e.clientY } };
          this.orbitP.enabled = this.orbitO.enabled = false;
          cv.setPointerCapture(e.pointerId);
        }
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.mode === 'walk') {
        if (document.pointerLockElement === cv) {
          this.walk.yaw -= e.movementX * 0.0025;
          this.walk.pitch = clamp(this.walk.pitch - e.movementY * 0.0025, -1.3, 1.3);
        } else if (this.walk.lookId === e.pointerId) {
          this.walk.yaw -= (e.clientX - this.walk.lookLast.x) * 0.005;
          this.walk.pitch = clamp(this.walk.pitch - (e.clientY - this.walk.lookLast.y) * 0.005, -1.3, 1.3);
          this.walk.lookLast = { x: e.clientX, y: e.clientY };
        }
        return;
      }
      if (this.drag) {
        if (!this.drag.moved && Math.hypot(e.clientX - this.drag.start.x, e.clientY - this.drag.start.y) < 4) return;
        this.drag.moved = true;
        const pt = new THREE.Vector3();
        this.raycaster.setFromCamera(this.ndc(e), this.camera());
        if (!this.raycaster.ray.intersectPlane(this.drag.plane, pt)) return;
        const id = this.drag.id;
        const off = this.drag.offset;
        store.live((p) => {
          const it = p.items.find((i) => i.id === id);
          if (it) moveItem(p, it, pt.x + off.x, pt.z + off.z, { noSnap: e.altKey });
        });
      }
    });
    const end = (e: PointerEvent) => {
      if (this.mode === 'walk') {
        if (this.walk.lookId === e.pointerId) this.walk.lookId = -1;
        return;
      }
      const wasDrag = this.drag?.moved;
      if (this.drag) {
        this.drag = null;
        this.orbitP.enabled = this.mode === 'orbit';
        this.orbitO.enabled = this.mode !== 'orbit';
        if (wasDrag) store.commit();
      }
      const d = this.pointerDown;
      this.pointerDown = null;
      if (!wasDrag && d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5 && e.type === 'pointerup') {
        const hit = this.pick(e);
        if (!hit) store.select(null);
        else if (hit.data.type === 'item') store.select({ type: 'item', id: hit.data.id });
        else if (hit.data.type === 'opening') store.select({ type: 'opening', id: hit.data.id });
        else if (hit.data.type === 'wall') store.select({ type: 'wall', roomId: hit.data.roomId, index: hit.data.index });
        else if (hit.data.type === 'floor' || hit.data.type === 'ceiling') store.select({ type: 'room', id: hit.data.roomId });
        else store.select(null);
      }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('dblclick', (e) => {
      // double click a floor in orbit mode to walk from there
      if (this.mode === 'walk') return;
      const hit = this.pick(e);
      if (hit?.data.type === 'floor') {
        // the app reacts to the camera change and calls setMode('walk') exactly once
        this.pendingWalkPoint = { x: hit.point.x, z: hit.point.z };
        store.setUI({ camera: 'walk' });
      }
    });

    window.addEventListener('keydown', (e) => {
      if (this.mode !== 'walk' || isTyping(e)) return;
      this.walk.keys.add(e.code);
      if (e.code === 'Escape') {
        store.setUI({ camera: 'orbit' });
        this.setMode('orbit');
      }
      if (e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.walk.keys.delete(e.code));
    window.addEventListener('blur', () => this.walk.keys.clear());

    // virtual joystick
    let joyId = -1;
    let joyCenter = { x: 0, y: 0 };
    const knob = this.joystickEl.firstElementChild as HTMLElement;
    this.joystickEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      joyId = e.pointerId;
      const r = this.joystickEl.getBoundingClientRect();
      joyCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      this.joystickEl.setPointerCapture(e.pointerId);
    });
    this.joystickEl.addEventListener('pointermove', (e) => {
      if (e.pointerId !== joyId) return;
      const max = 40;
      let dx = e.clientX - joyCenter.x;
      let dy = e.clientY - joyCenter.y;
      const l = Math.hypot(dx, dy);
      if (l > max) {
        dx = (dx / l) * max;
        dy = (dy / l) * max;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.walk.joy = { x: dx / max, y: dy / max };
    });
    const joyEnd = (e: PointerEvent) => {
      if (e.pointerId !== joyId) return;
      joyId = -1;
      knob.style.transform = '';
      this.walk.joy = { x: 0, y: 0 };
    };
    this.joystickEl.addEventListener('pointerup', joyEnd);
    this.joystickEl.addEventListener('pointercancel', joyEnd);
  }

  private resize() {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    if (this.mode !== 'orbit' && this.mode !== 'walk') {
      const zoom = this.ortho.zoom;
      this.fitOrtho(this.houseCenter().size * 1.25);
      this.ortho.zoom = zoom;
      this.ortho.updateProjectionMatrix();
    }
  }

  /** Light the nearest light fixtures to the area being looked at (fixed-size pool, no shader recompiles). */
  private assignLights() {
    const focus = this.mode === 'walk' ? this.persp.position : this.mode === 'orbit' ? this.orbitP.target : this.orbitO.target;
    const key = `${focus.x.toFixed(1)},${focus.z.toFixed(1)},${this.items.size},${this.structureSig.length}`;
    if (key === this.lightKey && !this.lightsDirty) return;
    this.lightKey = key;
    this.lightsDirty = false;
    const sources: { pos: THREE.Vector3; src: any; d: number }[] = [];
    for (const { obj } of this.items.values()) {
      const src = obj.userData.lightSource;
      if (!src) continue;
      const pos = obj.localToWorld(new THREE.Vector3(...(src.offset as [number, number, number])));
      sources.push({ pos, src, d: pos.distanceToSquared(focus) });
    }
    sources.sort((a, b) => a.d - b.d);
    this.lightPool.forEach((l, i) => {
      const s = sources[i];
      if (!s) {
        l.intensity = 0;
        return;
      }
      l.position.copy(s.pos);
      l.color.set(s.src.color);
      l.intensity = s.src.intensity;
      l.distance = s.src.range;
    });
  }

  private frame() {
    if (!this.visible) return;
    this.clock.update();
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.needsRebuild) {
      this.needsRebuild = false;
      this.rebuild();
    }
    if (this.mode === 'walk') this.updateWalk(dt);
    else if (this.mode === 'orbit') this.orbitP.update();
    else this.orbitO.update();
    if (this.selBox.visible) {
      const sel = store.ui.selection;
      const e = sel?.type === 'item' ? this.items.get(sel.id) : undefined;
      if (e) this.selBox.setFromObject(e.obj);
    }
    this.assignLights();
    const cam = this.camera();
    this.renderer.render(this.scene, cam);
    this.labels.render(this.scene, cam);
  }
}

function itemSignature(it: Item, p: Project): string {
  const { x, z, rotation, ...rest } = it;
  void x;
  void z;
  void rotation;
  return JSON.stringify(rest) + p.settings.renderStyle;
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o instanceof CSS2DObject) o.element.remove();
    const m = o as THREE.Mesh;
    if ((m.isMesh || (m as any).isLineSegments) && m.geometry && !(m.geometry as any).__shared) m.geometry.dispose();
    if (m.isMesh) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mt of mats) {
        if (!mt || mt.userData.cached) continue;
        const map = (mt as THREE.MeshStandardMaterial).map;
        if (map && map.userData.ownClone) map.dispose();
        mt.dispose();
      }
    }
  });
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
