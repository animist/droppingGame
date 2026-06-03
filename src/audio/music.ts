import { GAME } from '../config/balance';
import { getMusicBus } from './sfx';

/**
 * Procedural BGM（ファイル不要、WebAudio で合成）。
 * ルックアヘッド方式のステップシーケンサで、A マイナーペンタトニックの
 * ループを鳴らす。intensity（0〜3）でレイヤーが増えていく。
 */

let schedulerId: number | null = null;
let nextNoteTime = 0;
let step = 0;
let intensity = 0;
let running = false;

const TEMPO = GAME.MUSIC_TEMPO;        // BPM
const STEPS = 16;                      // 1ループのステップ数（16分換算で1小節）
const SECONDS_PER_STEP = 60 / TEMPO / 4;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;           // 何秒先までスケジュールするか

// --- パターン（16ステップ）---
// ベース: Am(bar前半) → F(bar後半) を想定したルート音
const BASS: number[] = [
  110.00, 0, 0, 0,   0, 0, 0, 0,     // A2
  87.31, 0, 0, 0,    0, 0, 0, 0,     // F2
];
// アルペジオ: bar前半 Am(A,C,E)、後半 F(F,A,C)
const ARP: number[] = [
  440.00, 523.25, 659.25, 523.25,    // A4 C5 E5 C5
  440.00, 523.25, 659.25, 523.25,
  349.23, 440.00, 523.25, 440.00,    // F4 A4 C5 A4
  349.23, 440.00, 523.25, 440.00,
];
const HAT_STEPS = [2, 6, 10, 14];

function playNote(
  ctx: AudioContext,
  bus: GainNode,
  freq: number,
  time: number,
  dur: number,
  type: OscillatorType,
  vol: number,
) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(vol, time + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0008, time + dur);
  osc.connect(g);
  g.connect(bus);
  osc.start(time);
  osc.stop(time + dur + 0.03);
}

function playHat(ctx: AudioContext, bus: GainNode, time: number) {
  // 短い高域ノイズでハイハット風
  const dur = 0.05;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.value = 0.06;
  src.connect(hp);
  hp.connect(g);
  g.connect(bus);
  src.start(time);
  src.stop(time + dur);
}

function scheduleStep(ctx: AudioContext, bus: GainNode, s: number, time: number) {
  // ベースは常時
  if (BASS[s]) playNote(ctx, bus, BASS[s], time, 0.55, 'triangle', 0.22);
  // intensity 1: アルペジオ
  if (intensity >= 1 && ARP[s]) playNote(ctx, bus, ARP[s], time, 0.24, 'sine', 0.10);
  // intensity 2: ハイハット
  if (intensity >= 2 && HAT_STEPS.includes(s)) playHat(ctx, bus, time);
  // intensity 3: 1オクターブ上の上声
  if (intensity >= 3 && ARP[s]) playNote(ctx, bus, ARP[s] * 2, time, 0.18, 'triangle', 0.05);
}

function scheduler() {
  const mb = getMusicBus();
  if (!mb) return;
  const { ctx, bus } = mb;
  if (ctx.state !== 'running') return; // suspended の間は待機（resume されたら再開）
  while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(ctx, bus, step, nextNoteTime);
    nextNoteTime += SECONDS_PER_STEP;
    step = (step + 1) % STEPS;
  }
}

export function startMusic() {
  const mb = getMusicBus();
  if (!mb) return;
  const { ctx, bus } = mb;
  if (running) return;
  running = true;
  step = 0;
  nextNoteTime = ctx.currentTime + 0.1;
  // フェードイン
  bus.gain.cancelScheduledValues(ctx.currentTime);
  bus.gain.setValueAtTime(bus.gain.value, ctx.currentTime);
  bus.gain.linearRampToValueAtTime(GAME.MUSIC_VOLUME, ctx.currentTime + 1.2);
  schedulerId = window.setInterval(scheduler, LOOKAHEAD_MS);
}

export function stopMusic() {
  if (!running) return;
  running = false;
  if (schedulerId !== null) {
    clearInterval(schedulerId);
    schedulerId = null;
  }
  const mb = getMusicBus();
  if (mb) {
    const { ctx, bus } = mb;
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setValueAtTime(bus.gain.value, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);
  }
}

export function setMusicIntensity(level: number) {
  intensity = Math.max(0, Math.min(3, level));
}

// スコア → intensity（0〜3）への変換
export function intensityFromScore(score: number): number {
  if (score < GAME.MUSIC_INTENSITY_1) return 0;
  if (score < GAME.MUSIC_INTENSITY_2) return 1;
  if (score < GAME.MUSIC_INTENSITY_3) return 2;
  return 3;
}
