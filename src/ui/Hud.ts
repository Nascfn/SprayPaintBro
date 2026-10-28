import './hud.css';

export const DEFAULT_HOTBAR = [
  '#f5f5f0',
  '#141414',
  '#e8261f',
  '#ff8a00',
  '#ffd60a',
  '#43d13b',
  '#1fb6ff',
  '#7b3fe4',
  '#ff4fa3',
];

/** A wider palette shown in the colour picker. */
const PALETTE = [
  '#ffffff', '#d9d9d4', '#a3a39e', '#6b6b67', '#3a3a38', '#000000',
  '#ffe5e5', '#ff9a8f', '#ff3b30', '#c2131b', '#7a0c12', '#3d0508',
  '#fff2cc', '#ffd166', '#ffb000', '#ff7b00', '#d9480f', '#7a2e0b',
  '#f4ffcc', '#c6f36b', '#7bd63a', '#2fa84f', '#0f6e3d', '#063d25',
  '#d6f7ff', '#7fe0ff', '#1fb6ff', '#0a6cff', '#1b3fa8', '#0b1c4f',
  '#f1e3ff', '#c79bff', '#8a4fff', '#5b21b6', '#ff8fd1', '#e0007a',
];

export interface HudCallbacks {
  /** User clicked to start or resume. */
  onPlay(): void;
  /** Picker closed (by button or key). */
  onPickerClosed(): void;
}

/** DOM overlay: crosshair, colour hotbar, nozzle indicator, menus and the colour picker. */
export class Hud {
  readonly hotbar = [...DEFAULT_HOTBAR];
  selected = 2;

  private readonly root = document.getElementById('hud')!;
  private readonly start = document.getElementById('start')!;
  private readonly pause = document.getElementById('pause')!;
  private readonly picker = document.getElementById('picker')!;
  private readonly crosshair = document.getElementById('crosshair')!;
  private readonly ring = document.getElementById('ring')!;
  private readonly slots: HTMLElement[] = [];
  private readonly nozzle = document.getElementById('nozzle')!;
  private readonly toast = document.getElementById('toast')!;
  private readonly custom = document.getElementById('custom-color') as HTMLInputElement;
  private readonly pickerSlot = document.getElementById('picker-slot')!;
  private toastTimer = 0;

  constructor(private readonly callbacks: HudCallbacks) {
    const bar = document.getElementById('hotbar')!;
    this.hotbar.forEach((_, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.innerHTML = `<span>${i + 1}</span>`;
      bar.appendChild(slot);
      this.slots.push(slot);
    });

    const grid = document.getElementById('palette')!;
    for (const color of PALETTE) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = color;
      b.title = color;
      b.addEventListener('click', () => this.assign(color));
      grid.appendChild(b);
    }
    this.custom.addEventListener('input', () => this.assign(this.custom.value));
    document.getElementById('picker-done')!.addEventListener('click', () => this.callbacks.onPickerClosed());

    this.start.addEventListener('click', () => this.callbacks.onPlay());
    this.pause.addEventListener('click', () => this.callbacks.onPlay());
    this.renderSlots();
  }

  get color(): string {
    return this.hotbar[this.selected];
  }

  setLoading(loading: boolean): void {
    this.start.classList.toggle('loading', loading);
  }

  select(index: number): void {
    this.selected = index;
    this.renderSlots();
  }

  setNozzle(name: string, index: number): void {
    this.nozzle.innerHTML = `<i class="cap cap-${index}"></i>${name} cap`;
  }

  showStart(show: boolean): void {
    this.start.hidden = !show;
  }

  showPause(show: boolean): void {
    this.pause.hidden = !show;
  }

  showPicker(show: boolean): void {
    this.picker.hidden = !show;
    if (show) {
      this.pickerSlot.textContent = String(this.selected + 1);
      this.custom.value = this.color;
    }
  }

  get pickerOpen(): boolean {
    return !this.picker.hidden;
  }

  showHud(show: boolean): void {
    this.root.classList.toggle('hidden', !show);
  }

  /**
   * Sizes the aim ring to the spray's footprint on the wall. `radiusPx` of 0 hides it;
   * `inRange` dims it when the wall is too far to reach.
   */
  setAim(radiusPx: number, inRange: boolean): void {
    if (radiusPx <= 0) {
      this.ring.style.opacity = '0';
      return;
    }
    const size = Math.max(6, Math.min(400, radiusPx * 2));
    this.ring.style.width = this.ring.style.height = `${size}px`;
    this.ring.style.opacity = inRange ? '0.85' : '0.25';
    this.crosshair.classList.toggle('far', !inRange);
  }

  flash(message: string): void {
    this.toast.textContent = message;
    this.toast.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), 1200);
  }

  private assign(color: string): void {
    this.hotbar[this.selected] = color;
    this.custom.value = color;
    this.renderSlots();
  }

  private renderSlots(): void {
    this.slots.forEach((slot, i) => {
      slot.style.setProperty('--c', this.hotbar[i]);
      slot.classList.toggle('active', i === this.selected);
    });
    this.ring.style.borderColor = this.color;
  }
}
