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

// PERFECT連続が途切れた瞬間の負の余韻（短い鈍い下降）。ゲームオーバーより軽く、通過より暗く。
export function playStreakLost() {
  tone({ freq: 440, freqEnd: 392, duration: 0.12, type: 'sawtooth', volume: 0.13 });
  setTimeout(() => tone({ freq: 294, freqEnd: 233, duration: 0.28, type: 'triangle', volume: 0.16 }), 90);
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

// PERFECT通過（アイデアA「ドレミ階段」/ 周回オクターブ上げ版）。
// Cメジャー(=Aナチュラルマイナー)のドレミファソラシドを、PERFECT連続1回につき1段ずつ登る。
// 1オクターブ登り切ったら次は1オクターブ上で再びドレミファ…と繰り返す（＝連続が伸びるほど
// どんどん高いキーへ）。耳保護のため上限オクターブで頭打ち。途切れれば streak=1 で最下段に戻る。
// C major は BGM(Am→F) と同じ音集合なので在keyのまま溶ける。
const A_SCALE = [
  523.25,  // C5
  587.33,  // D5
  659.25,  // E5
  698.46,  // F5
  783.99,  // G5
  880.0,   // A5
  987.77,  // B5
];
const A_SCALE_MAX_OCTAVE = 2; // 周回の上限（+2オクターブ＝最高でB7付近。これ以上は上げない）

// step（0始まり）→ 音階＋周回オクターブ の周波数
function aScaleFreq(step: number): number {
  const n = A_SCALE.length;
  const octave = Math.min(A_SCALE_MAX_OCTAVE, Math.floor(step / n));
  return A_SCALE[step % n] * Math.pow(2, octave);
}

export function playPerfectPass(streak = 1, pan = 0) {
  const step = Math.max(0, streak - 1);
  const lead = aScaleFreq(step);
  const below = aScaleFreq(Math.max(0, step - 1)); // 一つ下の段（オクターブ跨ぎも自然に追従）
  // 一段下→リード音への短い登り。音量はかなり控えめ。
  tone({ freq: below, duration: 0.06, type: 'triangle', volume: 0.045, pan });
  setTimeout(() => tone({ freq: lead, duration: 0.22, type: 'triangle', volume: 0.10, pan }), 55);
}

// === アイデアB: PERFECT連続で積み上がる持続コード（パッド） ===
// PERFECTごとに1声を低→高へ積み、鳴らし続ける＝チェーンが分厚い和音に育つ。
// streakが途切れると collapseChord() でピッチを落としながら崩落＝「育てて失う」を音で体現。
// メロSE(A, 高域C6〜)の“下”を埋める低めの帯域に置き、両者がぶつからないようにする。
//
// 2周目以降（lap>=1）は単なる音量増ではなく“質”が変わる（専用バス chordBus 経由）:
//  ① ローパスのカットオフが周回ごとに上がる＝暗い土台→明るく開けていく
//  ② フィルタを揺らすLFOの深さが周回ごとに増す＝静的ドローン→うねり/きらめき
//  ③ 周回ごとにオクターブ上の薄い“空気”の声を1枚足す＝上へ広がる艶・高さ
interface ChordVoice { osc: OscillatorNode; gain: GainNode; }

// 低→高の積層音（Aマイナーペンタの土台）。1周=この本数。周回ごとにスウェルさせる。
const CHORD_STACK = [
  220.0,   // A3（土台ドローン）
  329.63,  // E4
  440.0,   // A4
  523.25,  // C5
  587.33,  // D5
  659.25,  // E5
  783.99,  // G5
  880.0,   // A5
];
// 各音の音量。ピッチは上げず（同じ和音のまま）、周回ごとに音量だけを加算して育てる。
const CHORD_VOICE_GAIN_BASE = 0.01;    // 1周目の各音の音量
const CHORD_VOICE_GAIN_LAP = 0.00375;  // 周回ごとに各音へ加える増分
const CHORD_VOICE_GAIN_MAX = 0.026;    // 各音の上限

// ① フィルタ（明るさ）: lap0=暗め、周回ごとにカットオフ上昇＝開いていく
const CHORD_FILTER_BASE_HZ = 1200;     // lap0のカットオフ
const CHORD_FILTER_PER_LAP_HZ = 900;   // 周回ごとにカットオフを上げる量
const CHORD_FILTER_MAX_HZ = 6000;
// ② うねり: lap0=なし。2周目(lap>=1)からはライン通過1回ごとに wobble(0→1) を少しずつ上げ、
//    A=トレモロ（音量うねり, 主軸）と B=ビブラート（ピッチ微揺れ, 僅か）の深さを連動させる。
//    ※以前はフィルタのカットオフを揺らしていたが、①でカットオフが音域より上に開くと
//      ほぼ無効化されて聞こえなかったため、確実に聞こえる音量/ピッチ変調に変更。
const CHORD_WOBBLE_STEP = 0.05;        // 通過1回ごとの wobble 増分（0→1）
const CHORD_TREMOLO_RATE_HZ = 0.9;     // A: 音量うねりの速さ
const CHORD_TREMOLO_MAX_DEPTH = 0.5;   // A: 最大の揺れ幅（バス音量を 1±この値 で脈動）
const CHORD_VIBRATO_RATE_HZ = 0.4;     // B: ピッチ揺れの速さ（トレモロと少しずらす）
const CHORD_VIBRATO_MAX_CENTS = 12;    // B: 最大のピッチ揺れ（僅か）
// ③ オクターブ空気: 周回ごとに高域へ薄い声を1枚追加（lap1,2,3 の周波数）
const CHORD_AIR_GAIN = 0.012;
const CHORD_AIR_FREQS = [1318.51, 1760.0, 2637.02]; // E6 / A6 / E7

// index = CHORD_STACK の位置。周回で同じ位置を再訪して音量を上げる。
const chordSlots: (ChordVoice | null)[] = new Array(CHORD_STACK.length).fill(null);
let airVoices: ChordVoice[] = [];      // ③ 周回ごとに足す空気の声
let chordMaxLap = 0;                    // 現ストリークで到達した最大lap（質の変化の段数）
let chordWobble = 0;                    // ② うねりの進行度(0→1)。2周目以降は通過ごとに加算

// Bの専用バス: 全声 → chordBus → chordFilter(lowpass) → master。
// うねりは A:トレモロ（tremoloLfo→tremoloDepth→chordBus.gain）と
//          B:ビブラート（vibratoLfo→vibratoDepth→各声の detune）で出す。
let chordBus: GainNode | null = null;
let chordFilter: BiquadFilterNode | null = null;
let tremoloLfo: OscillatorNode | null = null;
let tremoloDepth: GainNode | null = null;
let vibratoLfo: OscillatorNode | null = null;
let vibratoDepth: GainNode | null = null;

function ensureChordBus() {
  if (!ctx || !masterGain || chordBus) return;
  chordBus = ctx.createGain();
  chordBus.gain.value = 1;
  chordFilter = ctx.createBiquadFilter();
  chordFilter.type = 'lowpass';
  chordFilter.frequency.value = CHORD_FILTER_BASE_HZ;
  chordFilter.Q.value = 0.7;
  chordBus.connect(chordFilter);
  chordFilter.connect(masterGain);
  // A: トレモロ＝バス音量を 1±depth で脈動（depth は wobble に連動。lap0は0＝静止）
  tremoloLfo = ctx.createOscillator();
  tremoloLfo.type = 'sine';
  tremoloLfo.frequency.value = CHORD_TREMOLO_RATE_HZ;
  tremoloDepth = ctx.createGain();
  tremoloDepth.gain.value = 0;
  tremoloLfo.connect(tremoloDepth);
  tremoloDepth.connect(chordBus.gain);
  tremoloLfo.start();
  // B: ビブラート＝各声の detune を ±cents で揺らす（声生成時に detune へ接続）
  vibratoLfo = ctx.createOscillator();
  vibratoLfo.type = 'sine';
  vibratoLfo.frequency.value = CHORD_VIBRATO_RATE_HZ;
  vibratoDepth = ctx.createGain();
  vibratoDepth.gain.value = 0;
  vibratoLfo.connect(vibratoDepth);
  vibratoLfo.start();
}

// 新しいlapに入った時だけ呼ぶ。①フィルタ開く ③空気の声を1枚足す。
// （②うねりは周回単位ではなく通過ごとに増やすので addChordLayer 側で処理する）
function applyChordLapState(lap: number, now: number) {
  if (chordFilter) {
    const cutoff = Math.min(CHORD_FILTER_MAX_HZ, CHORD_FILTER_BASE_HZ + lap * CHORD_FILTER_PER_LAP_HZ);
    chordFilter.frequency.setTargetAtTime(cutoff, now, 0.4);
  }
  // ③ この周回のオクターブ空気を1枚（lap1,2,3 まで）。バス経由＝フィルタ/揺らぎを共有。
  if (ctx && chordBus && lap >= 1 && lap <= CHORD_AIR_FREQS.length) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(CHORD_AIR_FREQS[lap - 1], now);
    if (vibratoDepth) vibratoDepth.connect(osc.detune); // B: ビブラートを共有
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(CHORD_AIR_GAIN, now + 0.5);
    osc.connect(gain);
    gain.connect(chordBus);
    osc.start(now);
    airVoices.push({ osc, gain });
  }
}

// PERFECT連続数に応じて積む/育てる。pos=周回内の位置, lap=周回数(0始まり)。
export function addChordLayer(streak: number) {
  if (!ctx || !masterGain) return;
  if (ctx.state !== 'running') { tryResume(); return; }
  if (streak < 1) return;
  ensureChordBus();
  if (!chordBus) return;
  const n = CHORD_STACK.length;
  const pos = (streak - 1) % n;
  const lap = Math.floor((streak - 1) / n);
  const now = ctx.currentTime;
  const target = Math.min(CHORD_VOICE_GAIN_MAX, CHORD_VOICE_GAIN_BASE + lap * CHORD_VOICE_GAIN_LAP);
  const v = chordSlots[pos];
  if (!v) {
    // 新規声: 0 から目標音量へクリーンにフェードイン。
    // ※ここで cancelScheduledValues+setValueAtTime(value) をやると、未処理の
    //   setValueAtTime(0) がキャンセルされ value=デフォルト1.0 にピン留めされて
    //   「1.0→目標」の下降ブリップが鳴る（過去のバグ）。新規声では絶対にやらない。
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(CHORD_STACK[pos], now);
    osc.detune.setValueAtTime((Math.random() * 2 - 1) * 6, now); // わずかな広がり
    if (vibratoDepth) vibratoDepth.connect(osc.detune); // B: ビブラート（detuneに加算）
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(target, now + 0.2);
    osc.connect(gain);
    gain.connect(chordBus);
    osc.start(now);
    chordSlots[pos] = { osc, gain };
  } else {
    // 既存声: 現在の実値から目標へ再ターゲット（2周目以降の音量スウェル）
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.linearRampToValueAtTime(target, now + 0.2);
  }
  // 新しいlapに入ったら“質”を一段進める（①フィルタ開く・③空気を1枚追加）
  if (lap > chordMaxLap) {
    chordMaxLap = lap;
    applyChordLapState(lap, now);
  }
  // ② 2周目(lap>=1)以降は、ライン通過1回ごとに wobble を少しずつ上げ、
  //    A=トレモロ（主軸）と B=ビブラート（僅か）の深さを連動して深める。
  if (lap >= 1) {
    chordWobble = Math.min(1, chordWobble + CHORD_WOBBLE_STEP);
    if (tremoloDepth) {
      tremoloDepth.gain.setTargetAtTime(chordWobble * CHORD_TREMOLO_MAX_DEPTH, now, 0.3);
    }
    if (vibratoDepth) {
      vibratoDepth.gain.setTargetAtTime(chordWobble * CHORD_VIBRATO_MAX_CENTS, now, 0.3);
    }
  }
}

// 積み上げたコードを崩す（streak途切れ／ゲームオーバー時）。ピッチを落としながら消す。
// バスの質（フィルタ/揺らぎ）も lap0 相当へ戻す。
export function collapseChord() {
  chordMaxLap = 0;
  chordWobble = 0;
  if (!ctx) {
    chordSlots.fill(null);
    airVoices = [];
    return;
  }
  const now = ctx.currentTime;
  const fade = (v: ChordVoice) => {
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.linearRampToValueAtTime(0, now + 0.3);
      v.osc.detune.cancelScheduledValues(now);
      v.osc.detune.linearRampToValueAtTime(-700, now + 0.3); // 崩れる感じに下げる
      v.osc.stop(now + 0.34);
    } catch {
      // 既に停止済みのノードは無視
    }
  };
  for (let i = 0; i < chordSlots.length; i++) {
    const v = chordSlots[i];
    if (v) fade(v);
    chordSlots[i] = null;
  }
  for (const v of airVoices) fade(v);
  airVoices = [];
  // バスを暗い静止状態（lap0相当）へ戻す: フィルタを閉じ、うねり(トレモロ/ビブラート)を0に
  if (chordFilter) {
    chordFilter.frequency.cancelScheduledValues(now);
    chordFilter.frequency.setTargetAtTime(CHORD_FILTER_BASE_HZ, now, 0.2);
  }
  if (tremoloDepth) {
    tremoloDepth.gain.cancelScheduledValues(now);
    tremoloDepth.gain.setTargetAtTime(0, now, 0.2);
  }
  if (vibratoDepth) {
    vibratoDepth.gain.cancelScheduledValues(now);
    vibratoDepth.gain.setTargetAtTime(0, now, 0.2);
  }
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
