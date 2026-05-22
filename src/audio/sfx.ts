import { GAME } from '../config/balance';

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;

function ensure(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(ctx.destination);
  }
  return ctx;
}

export function unlockAudio() {
  const c = ensure();
  if (c.state === 'suspended') {
    c.resume().catch(() => {});
  }
}

type ToneOpts = {
  freq: number;
  duration: number;
  type?: OscillatorType;
  volume?: number;
  attack?: number;
  freqEnd?: number;
};

function tone(opts: ToneOpts) {
  if (!ctx || ctx.state !== 'running' || !masterGain) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const attack = opts.attack ?? 0.005;
  const volume = opts.volume ?? 0.2;

  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, now);
  if (opts.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), now + opts.duration);
  }

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, now + opts.duration);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + opts.duration + 0.05);
}

export function playBounce(ballDiameter: number) {
  const t = clamp((ballDiameter - 30) / 100, 0, 1);
  const freq = 720 - (720 - 220) * t;
  tone({ freq, freqEnd: freq * 0.6, duration: 0.09, type: 'triangle', volume: 0.18 });
}

export function playWall() {
  tone({ freq: 380, freqEnd: 280, duration: 0.06, type: 'square', volume: 0.1 });
}

export function playPass() {
  tone({ freq: 880, duration: 0.08, type: 'triangle', volume: 0.2 });
  setTimeout(() => tone({ freq: 1320, duration: 0.08, type: 'triangle', volume: 0.2 }), 55);
  setTimeout(() => tone({ freq: 1760, duration: 0.16, type: 'triangle', volume: 0.2 }), 110);
}

export function playGameOver() {
  tone({ freq: 440, freqEnd: 110, duration: 0.6, type: 'sawtooth', volume: 0.22 });
}

export function playPerfectPass(streakCents = 0) {
  const mult = Math.pow(2, streakCents / 1200);
  tone({ freq: 1175 * mult, duration: 0.1, type: 'triangle', volume: 0.22 });
  setTimeout(() => tone({ freq: 1568 * mult, duration: 0.1, type: 'triangle', volume: 0.22 }), 50);
  setTimeout(() => tone({ freq: 1976 * mult, duration: 0.1, type: 'triangle', volume: 0.22 }), 100);
  setTimeout(() => tone({ freq: 2349 * mult, duration: 0.22, type: 'triangle', volume: 0.22 }), 150);
}

let fallOsc: OscillatorNode | null = null;
let fallFilter: BiquadFilterNode | null = null;
let fallGain: GainNode | null = null;

function ensureFallSound() {
  if (!ctx || !masterGain || fallOsc) return;
  fallOsc = ctx.createOscillator();
  fallOsc.type = GAME.FALL_OSC_TYPE;
  fallOsc.frequency.value = GAME.FALL_OSC_FREQ_BASE;

  fallFilter = ctx.createBiquadFilter();
  fallFilter.type = 'bandpass';
  fallFilter.frequency.value = GAME.FALL_FILTER_FREQ_BASE;
  fallFilter.Q.value = GAME.FALL_FILTER_Q;

  fallGain = ctx.createGain();
  fallGain.gain.value = 0;

  fallOsc.connect(fallFilter);
  fallFilter.connect(fallGain);
  fallGain.connect(masterGain);
  fallOsc.start();
}

export function updateFallSound(velocityY: number, maxVelocity: number, maxGain: number, streakCents = 0) {
  if (!ctx || ctx.state !== 'running') return;
  ensureFallSound();
  if (!fallOsc || !fallFilter || !fallGain) return;
  // 上下どちらの方向でも |velocityY| をベースに音を出す:
  //  - 落下中: |v|が0から最大へ上昇 → 音程・音量上昇
  //  - 上昇中: |v|が最大から0へ減少 → 音程・音量減衰（バウンス後の余韻）
  const speed = Math.abs(velocityY);
  const goingUp = velocityY < 0;
  const norm = Math.min(1, speed / maxVelocity);
  const now = ctx.currentTime;
  fallOsc.frequency.setTargetAtTime(
    GAME.FALL_OSC_FREQ_BASE + norm * GAME.FALL_OSC_FREQ_RANGE, now, 0.04,
  );
  // 上昇中の detune + パーフェクト連続による積み上げ detune
  fallOsc.detune.setTargetAtTime(
    (goingUp ? GAME.FALL_UPWARD_DETUNE_CENTS : 0) + streakCents, now, 0.04,
  );
  fallFilter.frequency.setTargetAtTime(
    GAME.FALL_FILTER_FREQ_BASE + norm * GAME.FALL_FILTER_FREQ_RANGE, now, 0.04,
  );
  fallGain.gain.setTargetAtTime(norm * maxGain, now, 0.04);
}

export function muteFallSound() {
  if (!ctx || !fallGain) return;
  fallGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
