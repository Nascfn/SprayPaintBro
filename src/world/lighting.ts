import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

/** Afternoon sun from the south-west, low enough to rake across the walls. */
const SUN_DIRECTION = new THREE.Vector3(-0.62, 0.55, 0.56).normalize();
const SHADOW_EXTENT = 35;

export class Lighting {
  readonly sun: THREE.DirectionalLight;
  private readonly sky: Sky;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.sky = new Sky();
    this.sky.scale.setScalar(450000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 5;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(SUN_DIRECTION);
    if (u.cloudCoverage) u.cloudCoverage.value = 0.35;
    scene.add(this.sky);

    // Image-based lighting from the sky gives windows and metal something to reflect.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(this.sky.clone());
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    scene.environmentIntensity = 0.4;
    pmrem.dispose();

    scene.add(new THREE.HemisphereLight(0xbcd2f0, 0x6a5a48, 0.45));

    this.sun = new THREE.DirectionalLight(0xffdcb0, 3.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -SHADOW_EXTENT;
    cam.right = cam.top = SHADOW_EXTENT;
    cam.near = 1;
    cam.far = 220;
    cam.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    scene.fog = new THREE.Fog(0xc8bba8, 60, 220);
  }

  /** Keeps the shadow map centred on the player, snapped to texels to avoid shimmering. */
  follow(position: THREE.Vector3): void {
    const texel = (SHADOW_EXTENT * 2) / this.sun.shadow.mapSize.x;
    const x = Math.round(position.x / texel) * texel;
    const z = Math.round(position.z / texel) * texel;
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x, 0, z).addScaledVector(SUN_DIRECTION, 100);
  }
}
