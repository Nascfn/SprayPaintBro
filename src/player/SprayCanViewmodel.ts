import * as THREE from 'three';

const SHAKE_DURATION = 0.6;

/**
 * The gloved hand and spray can in the bottom-right of the view. It lives in its own scene
 * and is drawn after the world with a cleared depth buffer, so it never clips into walls.
 */
export class SprayCanViewmodel {
  readonly scene = new THREE.Scene();
  private readonly root = new THREE.Group();
  private readonly rig = new THREE.Group();
  private readonly can = new THREE.Group();
  private readonly nozzle: THREE.Mesh;
  private readonly finger: THREE.Mesh;
  private readonly fingerRestY: number;
  private readonly capMaterial: THREE.MeshStandardMaterial;
  private readonly labelCanvas = document.createElement('canvas');
  private readonly labelTexture: THREE.CanvasTexture;
  private readonly labelColor = new THREE.Color();
  private shakeTime = 0;
  private sprayAmount = 0;
  private time = 0;

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x5a4a3c, 1.4));
    const key = new THREE.DirectionalLight(0xffe2bd, 2.2);
    key.position.set(-1, 2, 1.5);
    this.scene.add(key);
    this.scene.add(this.root);
    this.root.add(this.rig);
    this.rig.position.set(0.25, -0.24, -0.5);
    this.rig.add(this.can);

    this.labelCanvas.width = 256;
    this.labelCanvas.height = 128;
    this.labelTexture = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTexture.colorSpace = THREE.SRGBColorSpace;

    const metal = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.9, roughness: 0.3 });
    const label = new THREE.MeshStandardMaterial({ map: this.labelTexture, metalness: 0.3, roughness: 0.45 });
    this.capMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.35 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.17, 32, 1, true), label);
    body.position.y = 0.085;
    const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.033, 0.012, 32), metal);
    bottom.position.y = 0.002;
    const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.033, 0.03, 32), metal);
    shoulder.position.y = 0.185;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.01, 0.012, 16), this.capMaterial);
    cap.position.y = 0.206;
    this.nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.006, 8), white);
    this.nozzle.rotation.x = Math.PI / 2;
    this.nozzle.position.set(0, 0.208, -0.011);
    this.can.add(body, bottom, shoulder, cap, this.nozzle);

    // Fingerless glove and hoodie sleeve.
    const glove = new THREE.MeshStandardMaterial({ color: 0x3a3e46, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc58c6a, roughness: 0.7 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x3b4a5c, roughness: 0.95 });

    // The right hand grips the can from its right side: palm and wrist face the camera,
    // fingers wrap round the front and the index finger rests on the actuator.
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    this.can.add(
      limb(v(0.2, -0.32, 0.36), v(0.055, 0.04, 0.035), 0.05, sleeve),
      limb(v(0.055, 0.04, 0.035), v(0.045, 0.075, 0.02), 0.027, glove),
      limb(v(0.04, 0.075, 0.016), v(0.037, 0.13, 0.006), 0.024, glove),
      limb(v(0.04, 0.1, 0.03), v(0.004, 0.13, 0.036), 0.0105, skin),
    );
    for (const y of [0.125, 0.1, 0.075]) this.can.add(limb(v(0.04, y, -0.018), v(-0.022, y - 0.004, -0.03), 0.0105, skin));
    this.finger = limb(v(0.036, 0.155, -0.004), v(0.002, 0.222, -0.006), 0.0105, skin);
    this.can.add(this.finger);
    this.fingerRestY = this.finger.position.y;

    this.can.rotation.set(0.12, -0.25, 0.05);
    this.setColor(new THREE.Color(0xff0000));
  }

  setColor(color: THREE.Color): void {
    if (this.labelColor.equals(color)) return;
    this.labelColor.copy(color);
    this.capMaterial.color.copy(color);
    const ctx = this.labelCanvas.getContext('2d')!;
    const css = `#${color.getHexString(THREE.SRGBColorSpace)}`;
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, 256, 14);
    ctx.fillRect(0, 114, 256, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(0, 18, 256, 3);
    ctx.fillRect(0, 107, 256, 3);
    ctx.fillStyle = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b > 0.2 ? '#16181c' : '#f4f1ea';
    ctx.font = 'bold 40px Impact, "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SPB', 64, 78);
    ctx.fillText('SPB', 192, 78);
    this.labelTexture.needsUpdate = true;
  }

  shake(): void {
    this.shakeTime = SHAKE_DURATION;
  }

  get shaking(): boolean {
    return this.shakeTime > 0;
  }

  /** World position of the nozzle tip, where the mist comes out. */
  nozzleWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.nozzle.getWorldPosition(target);
  }

  update(dt: number, camera: THREE.Camera, spraying: boolean, bobPhase: number, moveAmount: number): void {
    this.time += dt;
    this.root.position.copy(camera.position);
    this.root.quaternion.copy(camera.quaternion);

    this.sprayAmount += ((spraying ? 1 : 0) - this.sprayAmount) * (1 - Math.exp(-dt * 18));
    this.shakeTime = Math.max(0, this.shakeTime - dt);

    const idle = Math.sin(this.time * 1.6) * 0.003;
    const swayX = Math.cos(bobPhase) * 0.012 * moveAmount;
    const swayY = Math.abs(Math.sin(bobPhase)) * 0.01 * moveAmount;
    // Spraying pushes the can forward and up towards the crosshair, with a slight tremble.
    const s = this.sprayAmount;
    const tremble = s * (Math.random() - 0.5) * 0.0015;
    let shakeY = 0;
    let shakeRot = 0;
    if (this.shakeTime > 0) {
      const t = this.shakeTime / SHAKE_DURATION;
      shakeY = Math.sin(this.time * 45) * 0.03 * t;
      shakeRot = Math.sin(this.time * 45) * 0.25 * t;
    }
    this.rig.position.set(
      0.25 - 0.06 * s + swayX + tremble,
      -0.24 + 0.05 * s + idle - swayY + shakeY + tremble,
      -0.5 - 0.06 * s,
    );
    this.rig.rotation.set(0.15 * s + shakeRot, 0.18 * s, 0);
    this.finger.position.y = this.fingerRestY - 0.006 * s;
  }
}

/** A capsule running between two points, for fingers and limbs. */
function limb(from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
  const dir = to.clone().sub(from);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.001, dir.length()), 6, 12), material);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, dir.normalize());
  return mesh;
}
