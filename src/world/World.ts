import * as THREE from 'three';
import { PaintSurface } from '../paint/PaintSurface';
import {
  asphaltTexture,
  brickTexture,
  chainLinkTexture,
  concreteTexture,
  corrugatedTexture,
  dirtTexture,
  paintedMetalTexture,
  sidewalkTexture,
  stuccoTexture,
  surfaceMaterial,
} from './textures';

type Face = 'px' | 'nx' | 'pz' | 'nz';
const ALL_FACES: Face[] = ['px', 'nx', 'pz', 'nz'];
const FACE_NORMALS: Record<Face, THREE.Vector3> = {
  px: new THREE.Vector3(1, 0, 0),
  nx: new THREE.Vector3(-1, 0, 0),
  pz: new THREE.Vector3(0, 0, 1),
  nz: new THREE.Vector3(0, 0, -1),
};
/** Paint only reaches so high, even standing on a dumpster. */
const MAX_PAINT_HEIGHT = 7;
/** Wide faces are split into segments so paint resolution stays high. */
const MAX_SEGMENT_WIDTH = 10;

interface BoxOptions {
  /** Material for the sides, or [sides, top] for a different roof/lid. */
  material: THREE.Material | [THREE.Material, THREE.Material];
  paint?: Face[] | boolean;
  collide?: boolean;
  castShadow?: boolean;
}

type Materials = ReturnType<typeof createMaterials>;

function createMaterials() {
  const redBrick = brickTexture([152, 66, 48], [176, 170, 160], 11);
  const tanBrick = brickTexture([192, 154, 112], [150, 146, 138], 23);
  const darkBrick = brickTexture([96, 58, 50], [140, 136, 130], 37);
  const concrete = concreteTexture([156, 154, 148], 41);
  const formed = concreteTexture([166, 163, 156], 43, true);
  return {
    redBrick: surfaceMaterial(redBrick, { normalScale: 1.2 }),
    tanBrick: surfaceMaterial(tanBrick, { normalScale: 1.2 }),
    darkBrick: surfaceMaterial(darkBrick, { normalScale: 1.2 }),
    concrete: surfaceMaterial(concrete),
    formedConcrete: surfaceMaterial(formed),
    roof: surfaceMaterial(concrete, { color: 0x77736c }),
    paleStucco: surfaceMaterial(stuccoTexture([214, 202, 178], 51)),
    blueStucco: surfaceMaterial(stuccoTexture([132, 158, 170], 53)),
    asphalt: surfaceMaterial(asphaltTexture(61), { roughness: 0.95 }),
    sidewalk: surfaceMaterial(sidewalkTexture(71)),
    shutter: surfaceMaterial(corrugatedTexture(81), { metalness: 0.5, roughness: 0.6 }),
    dumpster: surfaceMaterial(paintedMetalTexture([46, 92, 60], 91), { metalness: 0.4, roughness: 0.6 }),
    utility: surfaceMaterial(paintedMetalTexture([128, 134, 120], 93), { metalness: 0.4, roughness: 0.55 }),
    door: surfaceMaterial(paintedMetalTexture([58, 62, 70], 95), { metalness: 0.5, roughness: 0.5 }),
    dirt: surfaceMaterial(dirtTexture(101)),
    fence: (() => {
      const m = surfaceMaterial(chainLinkTexture(), { metalness: 0.8, roughness: 0.4 });
      m.alphaTest = 0.5;
      m.side = THREE.DoubleSide;
      return m;
    })(),
    glass: new THREE.MeshStandardMaterial({ color: 0x1b2530, roughness: 0.08, metalness: 0.2, envMapIntensity: 1.6 }),
    frame: new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.7 }),
    pole: new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.7, roughness: 0.45 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0x4a3f2a, roughness: 0.3 }),
    yellowLine: new THREE.MeshStandardMaterial({ color: 0xd9a92b, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }),
    whiteLine: new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }),
  };
}

/** Scales a box's UVs so textures tile at their real-world size on every face. */
function worldScaledBox(sx: number, sy: number, sz: number, sideTile: number, topTile: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const uv = geo.getAttribute('uv');
  // BoxGeometry faces in order: px, nx, py, ny, pz, nz, four vertices each.
  const dims: [number, number, number][] = [
    [sz, sy, sideTile],
    [sz, sy, sideTile],
    [sx, sz, topTile],
    [sx, sz, topTile],
    [sx, sy, sideTile],
    [sx, sy, sideTile],
  ];
  dims.forEach(([w, h, tile], face) => {
    for (let i = face * 4; i < face * 4 + 4; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
  });
  // Group 2 (top) gets material index 1 so roofs and lids can differ from the walls.
  geo.clearGroups();
  [0, 0, 1, 1, 0, 0].forEach((m, face) => geo.addGroup(face * 6, 6, m));
  return geo;
}

/** The city block: a street, an alley and a vacant lot with a long concrete wall. */
export class World {
  readonly group = new THREE.Group();
  readonly colliders: THREE.Box3[] = [];
  readonly surfaces: PaintSurface[] = [];
  /** Everything the spray can hit, including things that block it. */
  readonly raycastTargets: THREE.Object3D[] = [];
  readonly spawn = { position: new THREE.Vector3(-10, 0, 13.5), yaw: Math.PI };

  private readonly mats: Materials;
  private readonly windowMatrices: THREE.Matrix4[] = [];
  private readonly frameMatrices: THREE.Matrix4[] = [];

  constructor() {
    this.mats = createMaterials();
    this.buildGround();
    this.buildNorthSide();
    this.buildSouthSide();
    this.buildStreetEnds();
    this.buildStreetFurniture();
    this.buildWindows();
    this.addBoundary();
    for (const s of this.surfaces) {
      this.group.add(s.mesh);
      this.raycastTargets.push(s.mesh);
    }
  }

  private buildGround(): void {
    const m = this.mats;
    const ground = new THREE.PlaneGeometry(160, 160);
    const uv = ground.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 160) / 4, (uv.getY(i) * 160) / 4);
    const mesh = new THREE.Mesh(ground, m.asphalt);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.raycastTargets.push(mesh);

    // Sidewalks, raised to curb height.
    this.addBox([-45, 0, -9], [45, 0.15, -5], { material: [m.concrete, m.sidewalk], paint: false });
    this.addBox([-45, 0, 5], [45, 0.15, 9], { material: [m.concrete, m.sidewalk], paint: false });

    // Road markings.
    this.addStrip(-45, 45, -0.12, 0.1, m.yellowLine);
    this.addStrip(-45, 45, 0.12, 0.1, m.yellowLine);
    this.addStrip(-45, 45, -4.7, 0.12, m.whiteLine);
    this.addStrip(-45, 45, 4.7, 0.12, m.whiteLine);

    // Packed dirt in the vacant lot.
    const lot = new THREE.PlaneGeometry(30, 13);
    const luv = lot.getAttribute('uv');
    for (let i = 0; i < luv.count; i++) luv.setXY(i, (luv.getX(i) * 30) / 3, (luv.getY(i) * 13) / 3);
    const lotMesh = new THREE.Mesh(lot, m.dirt);
    lotMesh.rotation.x = -Math.PI / 2;
    lotMesh.position.set(-10, 0.01, 15.5);
    lotMesh.receiveShadow = true;
    this.group.add(lotMesh);
  }

  private buildNorthSide(): void {
    const m = this.mats;
    // Facades face the street (+z) at z = -9. The alley runs north between B1 and B2.
    this.addBuilding([-45, -31], [-22, -9], 12, m.redBrick, { windows: ['pz', 'px'], doors: [['pz', -30]] });
    this.addBuilding([-15, -31], [5, -9], 9, m.tanBrick, { windows: ['pz', 'nx'], doors: [['nx', -20]] });
    this.addBuilding([5, -25], [22, -9], 15, m.paleStucco, { windows: ['pz'], doors: [['pz', 12]] });
    this.addBuilding([22, -25], [45, -9], 8, m.concrete, { windows: ['pz'], doors: [['pz', 38]] });

    // Roll-up shutter on B2's storefront.
    this.addBox([-9, 0.15, -8.95], [-3, 3.2, -8.85], { material: m.shutter, paint: ['pz'] });
    this.addBox([-9.2, 3.2, -9], [-2.8, 3.6, -8.7], { material: m.door, paint: false });

    // Alley: back wall, dumpster and a utility box.
    this.addBox([-22, 0, -31], [-15, 4.5, -30.6], { material: [m.formedConcrete, m.concrete] });
    this.addBox([-21.6, 0, -27.5], [-19.8, 1.25, -26.4], { material: [m.dumpster, m.door] });
    this.addBox([-15.55, 0, -14.5], [-15, 1.4, -13.5], { material: m.utility });
  }

  private buildSouthSide(): void {
    const m = this.mats;
    // Facades face the street (-z) at z = 9. Between B5 and B6 is the vacant lot.
    this.addBuilding([-45, 9], [-25, 25], 10, m.blueStucco, { windows: ['nz', 'px'], doors: [['nz', -36]] });
    this.addBuilding([5, 9], [25, 25], 12, m.darkBrick, { windows: ['nz'], doors: [['nz', 16]] });
    this.addBuilding([25, 9], [45, 25], 7, m.tanBrick, { windows: ['nz'], doors: [['nz', 31]] });

    // The long wall at the back of the lot.
    this.addBox([-25, 0, 22], [5, 3.6, 22.3], { material: [m.formedConcrete, m.concrete] });

    // Chain-link fence along the lot's street side, with a gap to walk through.
    this.addFence(-25, -12, 9.1);
    this.addFence(-8, 5, 9.1);

    // Jersey barriers and a utility box inside the lot.
    this.addBox([-20, 0, 18], [-18, 0.8, 18.6], { material: m.concrete });
    this.addBox([-3, 0, 16], [-2.4, 0.8, 18], { material: m.concrete });
    this.addBox([-24.95, 0, 14], [-24.4, 1.4, 15.2], { material: m.utility });
  }

  private buildStreetEnds(): void {
    const m = this.mats;
    this.addBuilding([-58, -9], [-45, 9], 10, m.concrete, { windows: ['px'] });
    this.addBuilding([45, -9], [58, 9], 14, m.redBrick, { windows: ['nx'] });
    for (const z of [-4, -1, 2]) this.addBox([-44, 0, z], [-43.4, 0.8, z + 2], { material: m.concrete });
  }

  private buildStreetFurniture(): void {
    for (let x = -37; x <= 40; x += 15) {
      this.addStreetLight(x, -5.6, 1);
      if (x + 7 < 42) this.addStreetLight(x + 7, 5.6, -1);
    }
  }

  private addBuilding(
    min: [number, number],
    max: [number, number],
    height: number,
    wall: THREE.MeshStandardMaterial,
    opts: { windows?: Face[]; doors?: [Face, number][] } = {},
  ): void {
    const [x0, z0] = min;
    const [x1, z1] = max;
    this.addBox([x0, 0, z0], [x1, height, z1], { material: [wall, this.mats.roof] });

    // A cornice along the top of each street-facing side.
    for (const face of opts.windows ?? []) {
      const n = FACE_NORMALS[face];
      const out = 0.25;
      const bmin: [number, number, number] = [x0, height - 0.45, z0];
      const bmax: [number, number, number] = [x1, height, z1];
      if (face === 'px') [bmin[0], bmax[0]] = [x1 - 0.05, x1 + out];
      if (face === 'nx') [bmin[0], bmax[0]] = [x0 - out, x0 + 0.05];
      if (face === 'pz') [bmin[2], bmax[2]] = [z1 - 0.05, z1 + out];
      if (face === 'nz') [bmin[2], bmax[2]] = [z0 - out, z0 + 0.05];
      this.addBox(bmin, bmax, { material: this.mats.concrete, paint: false, collide: false });
      this.addWindowRows(face, n, x0, x1, z0, z1, height);
    }

    for (const [face, along] of opts.doors ?? []) {
      const d = 0.06;
      const w = 0.6;
      if (face === 'pz') this.addBox([along - w, 0.15, z1], [along + w, 2.3, z1 + d], { material: this.mats.door, paint: ['pz'] });
      if (face === 'nz') this.addBox([along - w, 0.15, z0 - d], [along + w, 2.3, z0], { material: this.mats.door, paint: ['nz'] });
      if (face === 'px') this.addBox([x1, 0, along - w], [x1 + d, 2.2, along + w], { material: this.mats.door, paint: ['px'] });
      if (face === 'nx') this.addBox([x0 - d, 0, along - w], [x0, 2.2, along + w], { material: this.mats.door, paint: ['nx'] });
    }
  }

  /** Window grid on a facade, from the second floor up so the street level stays paintable. */
  private addWindowRows(face: Face, n: THREE.Vector3, x0: number, x1: number, z0: number, z1: number, height: number): void {
    const alongX = face === 'pz' || face === 'nz';
    const start = alongX ? x0 : z0;
    const length = alongX ? x1 - x0 : z1 - z0;
    const plane = face === 'px' ? x1 : face === 'nx' ? x0 : face === 'pz' ? z1 : z0;
    const spacing = 3.2;
    const count = Math.floor((length - 1.5) / spacing);
    const margin = (length - (count - 1) * spacing) / 2;
    const rot = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(n.x, n.z));
    for (let y = 4.4; y + 1 < height - 0.8; y += 3.2) {
      for (let i = 0; i < count; i++) {
        const a = start + margin + i * spacing;
        const pos = alongX ? new THREE.Vector3(a, y, plane) : new THREE.Vector3(plane, y, a);
        this.frameMatrices.push(new THREE.Matrix4().compose(pos.clone().addScaledVector(n, 0.015), rot, new THREE.Vector3(1, 1, 1)));
        this.windowMatrices.push(new THREE.Matrix4().compose(pos.clone().addScaledVector(n, 0.03), rot, new THREE.Vector3(1, 1, 1)));
      }
    }
  }

  private buildWindows(): void {
    const make = (geo: THREE.BufferGeometry, mat: THREE.Material, matrices: THREE.Matrix4[]) => {
      const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
      matrices.forEach((mtx, i) => mesh.setMatrixAt(i, mtx));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.raycastTargets.push(mesh);
    };
    make(new THREE.BoxGeometry(1.5, 2.0, 0.05), this.mats.frame, this.frameMatrices);
    make(new THREE.BoxGeometry(1.3, 1.8, 0.04), this.mats.glass, this.windowMatrices);
  }

  private addStreetLight(x: number, z: number, facing: number): void {
    const m = this.mats;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 6, 12), m.pole);
    pole.position.set(x, 3, z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.6), m.pole);
    arm.position.set(x, 5.9, z + 0.75 * facing);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.6), m.lamp);
    head.position.set(x, 5.85, z + 1.5 * facing);
    for (const mesh of [pole, arm, head]) {
      mesh.castShadow = true;
      this.group.add(mesh);
      this.raycastTargets.push(mesh);
    }
    this.colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.12, 0, z - 0.12), new THREE.Vector3(x + 0.12, 6, z + 0.12)));
  }

  private addFence(x0: number, x1: number, z: number): void {
    const height = 2.2;
    const geo = new THREE.PlaneGeometry(x1 - x0, height);
    const uv = geo.getAttribute('uv');
    const tile = this.mats.fence.userData.tileSize as number;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (x1 - x0)) / tile, (uv.getY(i) * height) / tile);
    const mesh = new THREE.Mesh(geo, this.mats.fence);
    mesh.position.set((x0 + x1) / 2, height / 2, z);
    mesh.castShadow = true;
    this.group.add(mesh);
    for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / Math.ceil((x1 - x0) / 2.5)) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, height + 0.05, 8), this.mats.pole);
      post.position.set(x, (height + 0.05) / 2, z);
      post.castShadow = true;
      this.group.add(post);
    }
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, x1 - x0, 8), this.mats.pole);
    rail.rotation.z = Math.PI / 2;
    rail.position.set((x0 + x1) / 2, height, z);
    this.group.add(rail);
    this.colliders.push(new THREE.Box3(new THREE.Vector3(x0, 0, z - 0.05), new THREE.Vector3(x1, height, z + 0.05)));
  }

  private addStrip(x0: number, x1: number, z: number, width: number, mat: THREE.Material): void {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, width), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((x0 + x1) / 2, 0.004, z);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** Invisible walls so the player can never leave the block. */
  private addBoundary(): void {
    const walls: [[number, number, number], [number, number, number]][] = [
      [[-70, 0, -60], [70, 20, -45]],
      [[-70, 0, 35], [70, 20, 50]],
      [[-75, 0, -60], [-60, 20, 50]],
      [[60, 0, -60], [75, 20, 50]],
    ];
    for (const [a, b] of walls) this.colliders.push(new THREE.Box3(new THREE.Vector3(...a), new THREE.Vector3(...b)));
  }

  /** Adds a textured box with collisions and paintable vertical faces. */
  private addBox(min: [number, number, number], max: [number, number, number], opts: BoxOptions): THREE.Mesh {
    const [side, top] = Array.isArray(opts.material) ? opts.material : [opts.material, opts.material];
    const sx = max[0] - min[0];
    const sy = max[1] - min[1];
    const sz = max[2] - min[2];
    const sideTile = (side.userData.tileSize as number | undefined) ?? 1;
    const topTile = (top.userData.tileSize as number | undefined) ?? 1;
    const mesh = new THREE.Mesh(worldScaledBox(sx, sy, sz, sideTile, topTile), [side, top]);
    mesh.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    mesh.castShadow = opts.castShadow ?? true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.raycastTargets.push(mesh);

    if (opts.collide ?? true) this.colliders.push(new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)));

    const faces = opts.paint === false ? [] : opts.paint === true || opts.paint === undefined ? ALL_FACES : opts.paint;
    const paintHeight = Math.min(sy, MAX_PAINT_HEIGHT);
    for (const face of faces) {
      const normal = FACE_NORMALS[face];
      const width = face === 'px' || face === 'nx' ? sz : sx;
      const segments = Math.ceil(width / MAX_SEGMENT_WIDTH);
      const segWidth = width / segments;
      // Unit vector pointing to the right when looking at the face from outside.
      const right = new THREE.Vector3().crossVectors(THREE.Object3D.DEFAULT_UP, normal);
      const faceCenter = new THREE.Vector3(
        face === 'px' ? max[0] : face === 'nx' ? min[0] : mesh.position.x,
        min[1] + paintHeight / 2,
        face === 'pz' ? max[2] : face === 'nz' ? min[2] : mesh.position.z,
      );
      let prev: PaintSurface | null = null;
      for (let i = 0; i < segments; i++) {
        const center = faceCenter.clone().addScaledVector(right, (i + 0.5) * segWidth - width / 2);
        const surface = new PaintSurface({
          center,
          normal,
          width: segWidth,
          height: paintHeight,
          wallMaterial: side instanceof THREE.MeshStandardMaterial ? side : undefined,
          offsetU: i * segWidth,
        });
        if (prev) {
          prev.right = surface;
          surface.left = prev;
        }
        prev = surface;
        this.surfaces.push(surface);
      }
    }
    return mesh;
  }
}
