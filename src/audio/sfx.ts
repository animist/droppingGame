import { GAME } from '../config/balance';

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let fxSend: GainNode | null = null;
let autoResumeHookInstalled = false;

function ensure(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(ctx.destination);
    ensureFxBus(ctx, masterGain);
  }
  installAutoResumeHook();
  return ctx;
}

// ワンショット効果音用のフィードバックディレイ（センドバス）。
// tone() の出力を薄くここへ送り、合成音に空間的なまとまりを与える。
// 落下音（連続）と BGM はにごるためセンドしない。
function ensureFxBus(c: AudioContext, master: GainNode) {
  if (fxSend) return;
  if (GAME.AUDIO_DELAY_SEND <= 0) return; // 0 なら作らない（完全ドライ）
  fxSend = c.createGain();
  fxSend.gain.value = GAME.AUDIO_DELAY_SEND;
  const delay = c.createDelay(1);
  delay.delayTime.value = GAME.AUDIO_DELAY_TIME_S;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = GAME.AUDIO_DELAY_TONE_HZ;
  const fb = c.createGain();
  fb.gain.value = GAME.AUDIO_DELAY_FEEDBACK;
  // send → delay → lowpass → master（聴こえる山びこ）
  //                  └→ feedback → delay（繰り返し。ローパス越しなので回るほどこもる）
  fxSend.connect(delay);
  delay.connect(lp);
  lp.connect(fb);
  fb.connect(delay);
  lp.connect(master);
}

// BGM 用の独立した音量バス（SFX とは別系統で音量調整可能）。
// 出口にローパスフィルタを常設し、危険警告中の「こもり」演出に使う（通常時は全開）。
let musicFilter: BiquadFilterNode | null = null;
const MUSIC_FILTER_OPEN_HZ = 18000;

export function getMusicBus(): { ctx: AudioContext; bus: GainNode } | null {
  const c = ensure();
  if (!musicGain) {
    musicGain = c.createGain();
    musicGain.gain.value = 0;
    musicFilter = c.createBiquadFilter();
    musicFilter.type = 'lowpass';
    musicFilter.frequency.value = MUSIC_FILTER_OPEN_HZ;
    musicGain.connect(musicFilter);
    musicFilter.connect(c.destination);
  }
  return { ctx: c, bus: musicGain };
}

// 危険警告中などに BGM をこもらせる（true でローパス、false で全開に戻す）
export function setMusicMuffled(muffled: boolean) {
  if (!ctx || !musicFilter) return;
  const target = muffled ? GAME.MUSIC_MUFFLE_HZ : MUSIC_FILTER_OPEN_HZ;
  musicFilter.frequency.setTargetAtTime(target, ctx.currentTime, 0.15);
}

export function audioIsRunning(): boolean {
  return !!ctx && ctx.state === 'running';
}

// 横向きポーズ中など、音全体（BGM + SFX + 落下音）を一括で停止/再開する。
// AudioContext を suspend するとオシレーターも進行が止まり、resume で再開する。
let manuallySuspended = false;
export function setAudioSuspended(suspended: boolean) {
  if (!ctx) return;
  manuallySuspended = suspended;
  if (suspended) {
    if (ctx.state === 'running') ctx.suspend().catch(() => {});
  } else if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

export function isAudioManuallySuspended(): boolean {
  return manuallySuspended;
}

function tryResume() {
  // 横向きポーズなどで手動サスペンド中は自動再開しない
  if (manuallySuspended) return;
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

// AudioContext は backgrounding / 画面ロック / 一定時間アイドル等で
// suspended に戻ることがある。これを検知して resume を試みる。
function installAutoResumeHook() {
  if (autoResumeHookInstalled || typeof document === 'undefined') return;
  autoResumeHookInstalled = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tryResume();
  });
  // どのシーンでもユーザー操作が起きたら resume を試みる
  const onInteract = () => tryResume();
  document.addEventListener('pointerdown', onInteract, { capture: true, passive: true });
  document.addEventListener('touchstart', onInteract, { capture: true, passive: true });
  document.addEventListener('keydown', onInteract, { capture: true, passive: true });
}

export function unlockAudio() {
  const c = ensure();
  // iOS Safari 対策: ユーザータップ中に 1サンプルの無音バッファを実際に再生して
  // AudioContext を完全アンロックする（ctx.resume() だけでは足りない場合がある）
  try {
    const buf = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
  } catch {
    // 古い実装で createBuffer が失敗してもアンロック試行は継続
  }
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
  detune?: number;       // 固定 detune（cents）
  detuneJitter?: number; // ±この範囲(cents)でランダムに揺らす
  volumeJitter?: number; // ±この割合で音量をランダムに揺らす（0.4=±40%）
  pan?: number;          // -1(左) 〜 +1(右) のステレオ定位
};

function tone(opts: ToneOpts) {
  if (!ctx || !masterGain) return;
  // suspended の場合は resume を試みる。今回の音は出ない可能性があるが、次回以降は復活する。
  if (ctx.state !== 'running') {
    tryResume();
    return;
  }
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const attack = opts.attack ?? 0.005;
  const baseVolume = opts.volume ?? 0.2;
  const volJitter = opts.volumeJitter ? 1 + (Math.random() * 2 - 1) * opts.volumeJitter : 1;
  const volume = baseVolume * volJitter;

  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, now);
  const jitter = opts.detuneJitter ? (Math.random() * 2 - 1) * opts.detuneJitter : 0;
  osc.detune.setValueAtTime((opts.detune ?? 0) + jitter, now);
  if (opts.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), now + opts.duration);
  }

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, now + opts.duration);

  osc.connect(gain);
  // ステレオパンが指定されていれば PannerNode を挟む
  let out: AudioNode = gain;
  if (opts.pan !== undefined && typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(Math.max(-1, Math.min(1, opts.pan)), now);
    gain.connect(panner);
    out = panner;
  }
  out.connect(masterGain);          // ドライ
  if (fxSend) out.connect(fxSend);  // ウェット（ディレイへ薄くセンド）
  osc.start(now);
  osc.stop(now + opts.duration + 0.05);
}

export function playBounce(ballDiameter: number, pan = 0) {
  const t = clamp((ballDiameter - 30) / 100, 0, 1);
  const freq = 720 - (720 - 220) * t;
  // 長さも僅かにランダム化して1回ごとの個性を増やす
  const duration = 0.09 * (0.8 + Math.random() * 0.4);
  tone({
    freq, freqEnd: freq * 0.6, duration, type: 'triangle', volume: 0.18,
    detuneJitter: GAME.BOUNCE_DETUNE_JITTER, volumeJitter: GAME.BOUNCE_VOLUME_JITTER, pan,
  });
}

export function playWall(pan = 0) {
  tone({
    freq: 380, freqEnd: 280, duration: 0.06, type: 'square', volume: 0.1,
    detuneJitter: GAME.WALL_DETUNE_JITTER, volumeJitter: GAME.BOUNCE_VOLUME_JITTER, pan,
  });
}

export function playPass(pan = 0) {
  tone({ freq: 880, duration: 0.08, type: 'triangle', volume: 0.2, pan });
  setTimeout(() => tone({ freq: 1320, duration: 0.08, type: 'triangle', volume: 0.2, pan }), 55);
  setTimeout(() => tone({ freq: 1760, duration: 0.16, type: 'triangle', volume: 0.2, pan }), 110);
}

// ニアミス: 鋭い上向きの「ヒュッ」という緊張感のある音
export function playNearMiss(pan = 0) {
  tone({ freq: 600, freqEnd: 1500, duration: 0.16, type: 'sawtooth', volume: 0.16, pan });
  setTimeout(() => tone({ freq: 1800, duration: 0.10, type: 'sine', volume: 0.14, pan }), 90);
}

// ベスト超え: プレイ中に自己ベストを上回った瞬間の短い祝福チャイム
// （マイルストーンより軽く、通過音より特別に）
export function playBestBeaten() {
  tone({ freq: 1046.5, duration: 0.12, type: 'triangle', volume: 0.2 });   // C6
  setTimeout(() => tone({ freq: 1568.0, duration: 0.26, type: 'triangle', volume: 0.2 }), 100); // G6
  setTimeout(() => tone({ freq: 2093.0, duration: 0.40, type: 'sine', volume: 0.12 }), 200);    // C7 きらめき
}

// マイルストーン: 明るく開けた上昇ファンファーレ（メジャーアルペジオ）
export function playMilestone() {
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((f, i) => {
    setTimeout(() => tone({ freq: f, duration: 0.22, type: 'triangle', volume: 0.22 }), i * 90);
  });
  // 最後に重ねて広がり
  setTimeout(() => tone({ freq: 1318.5, duration: 0.5, type: 'triangle', volume: 0.16 }), 360);
}

// ゲームオーバーの瞬間: C(下降グリス)を 100ms 間隔で 3 回重ねて鳴らす
export function playGameOver() {
  playGameOverC();
  setTimeout(() => playGameOverC(), 180);
  setTimeout(() => playGameOverC(), 360);
}

// RESULT 画面のメロディ: A → 一拍休符 → B
// A は約 560ms で終わるので、その後 400ms 休符を入れて B を 960ms 後に開始
export function playResultMelody() {
  setTimeout(() => playGameOverA(), 180);
  setTimeout(() => playGameOverB(), 960);
}

// === GAME OVER 候補音（サウンドテスト用） ===

// A: 8bit 死亡風（クロマチック下降、矩形波）
export function playGameOverA() {
  tone({ freq: 932, duration: 0.10, type: 'square', volume: 0.18 });
  setTimeout(() => tone({ freq: 740, duration: 0.10, type: 'square', volume: 0.18 }), 120);
  setTimeout(() => tone({ freq: 554, duration: 0.10, type: 'square', volume: 0.18 }), 240);
  setTimeout(() => tone({ freq: 440, duration: 0.20, type: 'square', volume: 0.18 }), 360);
}

// B: 哀愁マイナーアルペジオ（C minor 下降、三角波）
export function playGameOverB() {
  tone({ freq: 523, duration: 0.18, type: 'triangle', volume: 0.20 });
  setTimeout(() => tone({ freq: 415, duration: 0.18, type: 'triangle', volume: 0.20 }), 180);
  setTimeout(() => tone({ freq: 311, duration: 0.18, type: 'triangle', volume: 0.20 }), 360);
  setTimeout(() => tone({ freq: 262, duration: 0.50, type: 'triangle', volume: 0.20 }), 540);
}

// C: ワーン...諦め下降グリッサンド（1音、長く下げる）
export function playGameOverC() {
  tone({ freq: 880, freqEnd: 110, duration: 1.20, type: 'sawtooth', volume: 0.22 });
}

// D: 重低音の鐘（オクターブ重ね、長い減衰）
export function playGameOverD() {
  tone({ freq: 110, duration: 1.50, type: 'sine', volume: 0.28, attack: 0.005 });
  tone({ freq: 220, duration: 1.50, type: 'triangle', volume: 0.14, attack: 0.005 });
}

// E: 不協和2音重ね（半音差、ピアノ的ザワッ感）
export function playGameOverE() {
  tone({ freq: 349, duration: 0.70, type: 'triangle', volume: 0.18 });
  tone({ freq: 370, duration: 0.70, type: 'triangle', volume: 0.18 });
}

export function playPerfectPass(streakCents = 0, pan = 0) {
  const mult = Math.pow(2, streakCents / 1200);
  tone({ freq: 1175 * mult, duration: 0.1, type: 'triangle', volume: 0.22, pan });
  setTimeout(() => tone({ freq: 1568 * mult, duration: 0.1, type: 'triangle', volume: 0.22, pan }), 50);
  setTimeout(() => tone({ freq: 1976 * mult, duration: 0.1, type: 'triangle', volume: 0.22, pan }), 100);
  setTimeout(() => tone({ freq: 2349 * mult, duration: 0.22, type: 'triangle', volume: 0.22, pan }), 150);
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
  if (!ctx) return;
  if (ctx.state !== 'running') {
    tryResume();
    return;
  }
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
