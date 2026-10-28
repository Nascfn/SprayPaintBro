/**
 * All sound is synthesized with Web Audio: the hiss is filtered noise, the can rattle is a
 * burst of short metallic clicks and footsteps are low thumps. No audio files needed.
 */
export class SprayAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private hissGain!: GainNode;
  private hissFilter!: BiquadFilterNode;
  private hissing = false;

  /** Must be called from a user gesture (browsers block audio until then). */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.hissFilter = ctx.createBiquadFilter();
    this.hissFilter.type = 'bandpass';
    this.hissFilter.frequency.value = 5200;
    this.hissFilter.Q.value = 0.55;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 9000;
    shelf.gain.value = -8;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    src.connect(this.hissFilter).connect(shelf).connect(this.hissGain).connect(this.master);
    src.start();
  }

  /** Starts or stops the hiss. `closeness` in [0,1] darkens the tone as the can nears the wall. */
  setSpraying(on: boolean, closeness = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.hissFilter.frequency.setTargetAtTime(5600 - closeness * 1800, t, 0.05);
    if (on === this.hissing) return;
    this.hissing = on;
    this.hissGain.gain.cancelScheduledValues(t);
    if (on) {
      // A quick "pssh" overshoot before settling into a steady hiss.
      this.hissGain.gain.setValueAtTime(this.hissGain.gain.value, t);
      this.hissGain.gain.linearRampToValueAtTime(0.32, t + 0.02);
      this.hissGain.gain.linearRampToValueAtTime(0.22, t + 0.15);
    } else {
      this.hissGain.gain.setTargetAtTime(0, t, 0.03);
    }
  }

  /** The mixing ball clattering inside the can. */
  rattle(duration = 0.6): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const clicks = Math.round(duration * 14);
    for (let i = 0; i < clicks; i++) {
      const t = ctx.currentTime + (i / clicks) * duration + Math.random() * 0.015;
      this.click(t, 0.25 + Math.random() * 0.2);
    }
  }

  footstep(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380 + Math.random() * 160;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 1.5, 0.2);
  }

  private click(t: number, level: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2400 + Math.random() * 1800;
    filter.Q.value = 6;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 1.5, 0.06);

    // A faint metallic ping from the can body.
    const osc = ctx.createOscillator();
    osc.frequency.value = 3100 + Math.random() * 400;
    const ping = ctx.createGain();
    ping.gain.setValueAtTime(level * 0.08, t);
    ping.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    osc.connect(ping).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.05);
  }
}
