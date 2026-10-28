import * as THREE from 'three';
import { SprayAudio } from '../audio/SprayAudio';
import { Drips } from '../paint/Drips';
import { PaintRenderer } from '../paint/PaintRenderer';
import { PaintSystem } from '../paint/PaintSystem';
import { SprayParticles } from '../paint/SprayParticles';
import { MAX_SPRAY_DISTANCE } from '../paint/sprayMath';
import { PlayerController } from '../player/PlayerController';
import { SprayCanViewmodel } from '../player/SprayCanViewmodel';
import { Hud } from '../ui/Hud';
import { Lighting } from '../world/lighting';
import { World } from '../world/World';

type State = 'start' | 'playing' | 'paused' | 'picker';

const FOV = 72;
/** Longest frame step, so a hitch never tunnels the player through a wall. */
const MAX_DT = 1 / 20;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 600);
  readonly world: World;
  readonly player: PlayerController;
  readonly paint: PaintSystem;
  readonly drips: Drips;
  readonly hud: Hud;

  private readonly lighting: Lighting;
  private readonly painter: PaintRenderer;
  private readonly particles = new SprayParticles();
  private readonly viewmodel = new SprayCanViewmodel();
  private readonly audio = new SprayAudio();
  private readonly timer = new THREE.Timer();
  private readonly nozzlePos = new THREE.Vector3();
  private readonly sprayTarget = new THREE.Vector3();
  private state: State = 'start';
  private trigger = false;

  constructor(
    container: HTMLElement,
    private readonly debug = false,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.62;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Paint render targets are drawn into without clearing; the main pass clears manually.
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    this.lighting = new Lighting(this.scene, this.renderer);
    this.world = new World();
    this.scene.add(this.world.group, this.particles.points);

    this.painter = new PaintRenderer(this.renderer);
    this.drips = new Drips(this.painter);
    this.paint = new PaintSystem(this.camera, this.world.raycastTargets, this.painter, this.drips);

    this.player = new PlayerController(this.camera, this.renderer.domElement, this.world.colliders);
    this.player.onStep = () => this.audio.footstep();
    const { position, yaw } = this.world.spawn;
    this.player.teleport(position.x, position.y, position.z, yaw);

    this.hud = new Hud({
      onPlay: () => this.requestPlay(),
      onPickerClosed: () => this.closePicker(),
    });
    this.selectColor(this.hud.selected);
    this.hud.setNozzle(this.paint.nozzle.name, this.paint.nozzleIndex);

    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (debug) this.exposeDebugApi();
  }

  start(): void {
    this.hud.setLoading(false);
    this.timer.connect(document);
    this.renderer.setAnimationLoop((t) => {
      this.timer.update(t);
      this.tick(Math.min(this.timer.getDelta(), MAX_DT));
    });
  }

  private get locked(): boolean {
    return this.player.controls.isLocked;
  }

  private requestPlay(): void {
    this.audio.init();
    const el = this.renderer.domElement;
    try {
      const result = el.requestPointerLock() as unknown as Promise<void> | undefined;
      result?.catch?.(() => this.onLockFailed());
    } catch {
      this.onLockFailed();
    }
  }

  private onLockFailed(): void {
    // Automation and some embedded browsers have no pointer lock; debug mode plays without it.
    if (this.debug) this.setState('playing');
  }

  private setState(state: State): void {
    this.state = state;
    this.hud.showStart(state === 'start');
    this.hud.showPause(state === 'paused');
    this.hud.showPicker(state === 'picker');
    this.hud.showHud(state === 'playing');
    if (state !== 'playing') this.trigger = false;
  }

  private openPicker(): void {
    this.setState('picker');
    if (this.locked) this.player.controls.unlock();
  }

  private closePicker(): void {
    this.selectColor(this.hud.selected);
    this.setState('paused');
    this.requestPlay();
  }

  private selectColor(index: number): void {
    this.hud.select(index);
    this.paint.color.set(this.hud.color);
  }

  private bindInput(): void {
    const controls = this.player.controls;
    controls.addEventListener('lock', () => this.setState('playing'));
    controls.addEventListener('unlock', () => {
      if (this.state !== 'picker') this.setState('paused');
    });

    const canPlay = () => this.state === 'playing';
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && canPlay()) this.trigger = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.trigger = false;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (!canPlay() || e.deltaY === 0) return;
        this.paint.cycleNozzle(e.deltaY > 0 ? 1 : -1);
        this.hud.setNozzle(this.paint.nozzle.name, this.paint.nozzleIndex);
      },
      { passive: true },
    );

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        if (this.state === 'playing') this.openPicker();
        else if (this.state === 'picker') this.closePicker();
        return;
      }
      if (!canPlay()) return;
      if (/^Digit[1-9]$/.test(e.code)) {
        this.selectColor(Number(e.code.slice(5)) - 1);
      } else if (e.code === 'KeyR' && !e.repeat) {
        this.viewmodel.shake();
        this.audio.rattle();
      } else if (e.code === 'KeyC' && !e.repeat) {
        this.hud.flash(this.paint.clearAimed() ? 'Wall buffed clean' : 'Aim at a painted wall to clear it');
      } else if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.hud.flash(this.paint.undo() ? 'Undo' : 'Nothing to undo');
      }
    });
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles.setViewportHeight(h * this.renderer.getPixelRatio(), FOV);
  }

  /** Advances the simulation by `dt` seconds and renders a frame. */
  tick(dt: number): void {
    const playing = this.state === 'playing';
    this.player.update(dt, playing && (this.locked || this.debug));
    this.lighting.follow(this.player.position);

    // Shaking the can takes both hands' attention: no spraying mid-rattle.
    this.paint.spraying = playing && this.trigger && !this.viewmodel.shaking;
    this.paint.update(dt);
    this.drips.update(dt);

    const aim = this.paint.aim;
    if (this.paint.spraying) {
      this.viewmodel.nozzleWorldPosition(this.nozzlePos);
      const reach = Math.min(aim.distance, MAX_SPRAY_DISTANCE);
      if (aim.point && aim.distance < MAX_SPRAY_DISTANCE + 0.3) this.sprayTarget.copy(aim.point);
      else this.camera.getWorldDirection(this.sprayTarget).multiplyScalar(MAX_SPRAY_DISTANCE).add(this.camera.position);
      const travel = this.nozzlePos.distanceTo(this.sprayTarget);
      this.particles.emit(dt, this.nozzlePos, this.sprayTarget, Math.min(travel, reach + 0.3), aim.radius * 0.6, this.paint.color);
    }
    this.particles.update(dt);

    this.viewmodel.setColor(this.paint.color);
    this.viewmodel.update(dt, this.camera, this.paint.spraying, this.player.bobPhase, this.player.moveAmount);
    const closeness = aim.surface ? 1 - Math.min(1, aim.sprayDistance / MAX_SPRAY_DISTANCE) : 0;
    this.audio.setSpraying(this.paint.spraying, closeness);

    if (aim.surface && playing) {
      const focal = window.innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
      this.hud.setAim((aim.radius * 0.5 * focal) / aim.distance, aim.sprayDistance < MAX_SPRAY_DISTANCE);
    } else {
      this.hud.setAim(0, false);
    }

    this.painter.flush();
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.viewmodel.scene, this.camera);
  }

  /** `?debug` hooks for scripted testing without pointer lock. */
  private exposeDebugApi(): void {
    const api = {
      game: this,
      THREE,
      play: () => this.setState('playing'),
      teleport: (x: number, z: number, yaw = 0, pitch = 0) => this.player.teleport(x, 0, z, yaw, pitch),
      spray: (on: boolean) => {
        this.trigger = on;
      },
      color: (index: number) => this.selectColor(index),
      nozzle: (index: number) => {
        this.paint.nozzleIndex = index;
        this.hud.setNozzle(this.paint.nozzle.name, index);
      },
      /** Runs the game loop for `seconds` at a fixed step, regardless of rAF throttling. */
      advance: (seconds: number, step = 1 / 60) => {
        for (let t = 0; t < seconds; t += step) this.tick(step);
      },
      stats: () => ({
        state: this.state,
        position: this.player.position.toArray().map((v) => +v.toFixed(2)),
        painted: this.world.surfaces.filter((s) => s.painted).length,
        surfaces: this.world.surfaces.length,
        drips: this.drips.count,
        aim: {
          surface: this.paint.aim.surface !== null,
          distance: +this.paint.aim.distance.toFixed(2),
          radius: +this.paint.aim.radius.toFixed(3),
        },
        drawCalls: this.renderer.info.render.calls,
      }),
    };
    (window as unknown as { __game: typeof api }).__game = api;
  }
}
