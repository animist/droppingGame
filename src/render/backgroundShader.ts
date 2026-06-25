import Phaser from 'phaser';
import { GAME } from '../config/balance';

/**
 * Phase 1: 手続き背景シェーダ。
 * 既存の「フラット背景色 + パララックス54ドット + bgShade」を1枚のフラグメントシェーダに置換する。
 *
 * - 縦グラデ＋難易度進行(progress)での色補間（classic の BG_COLOR_START→END と同等）
 * - ゆるい星雲 + 上方向に流れる多層スターフィールド（パララックスの奥行き感の代替、全部GPU側で生成）
 * - 軽いビネット
 *
 * 動的 uniform は progress(1f) のみ。time/resolution は Phaser の Shader GO が自動更新する。
 *
 * 注意: smoothstep(edge0, edge1, x) は edge0 >= edge1 だと結果が未定義（ドライバによりNaN→黒画面）。
 *       必ず edge0 < edge1 にし、反転は `1.0 - smoothstep(...)` で行う。
 */

// balance.ts と同期: BG_COLOR_START=0x1a1a2e, BG_COLOR_END=0x4a081f
// 0x1a/255=0.102, 0x2e/255=0.180 / 0x4a/255=0.290, 0x08/255=0.031, 0x1f/255=0.122
const FRAG = `
// モバイル(Android Chrome等)は mediump を本当に16bitで扱い、大きな中間値で Inf/NaN→黒画面に
// なる。対応端末では highp を使う（PCは元々32bit相当なので影響なし）。
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform float time;
uniform vec2 resolution;
uniform float progress;   // 0=序盤色, 1=終盤色（難易度進行）

varying vec2 fragCoord;

const vec3 COL_START = vec3(0.102, 0.102, 0.180); // 青紫
const vec3 COL_END   = vec3(0.290, 0.031, 0.122); // 赤紫

// 中間値を小さく保つ精度耐性の高いハッシュ（Hoskins系）。mediumpフォールバックでも壊れにくい。
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 上方向へ流れる1層分のスターフィールド。セル分割して一部のセルに点を置く。
float starLayer(vec2 uv, float scale, float speed, float density) {
  uv.y -= time * speed;          // 下→上（上方向）へ流れる。classicのパララックス上昇と一致
  uv *= scale;
  vec2 cell = floor(uv);
  vec2 f = fract(uv) - 0.5;
  float h = hash21(cell);
  float on = step(1.0 - density, h);
  vec2 jitter = (vec2(hash21(cell + 1.7), hash21(cell + 3.3)) - 0.5) * 0.6;
  float d = length(f - jitter);
  // 中心(d=0)で1、半径0.16で0。smoothstepは edge0<edge1 にして反転で立ち上げる。
  // ※変数名は組み込み関数 dot() と衝突しないよう spark にする（衝突するとコンパイル失敗）。
  float spark = 1.0 - smoothstep(0.0, 0.16, d);
  float tw = 0.6 + 0.4 * sin(time * (1.0 + h * 2.0) + h * 6.28); // ほのかな明滅
  return spark * on * tw;
}

void main(void) {
  vec2 uv = fragCoord / resolution;            // 0..1

  // ベース色: 難易度進行で青紫→赤紫、さらに縦グラデで下を少し明るく
  vec3 base = mix(COL_START, COL_END, clamp(progress, 0.0, 1.0));
  base *= mix(0.90, 1.20, uv.y);

  // ゆるい星雲（低周波の明暗で奥行きを出す）
  float neb = sin(uv.x * 4.0 + time * 0.05) * sin(uv.y * 3.0 - time * 0.04);
  base += mix(vec3(0.04, 0.05, 0.10), vec3(0.12, 0.03, 0.06), clamp(progress, 0.0, 1.0))
          * (0.5 + 0.5 * neb);

  // アスペクト比を考慮した座標（点が縦長に潰れないように）
  vec2 auv = vec2(uv.x * (resolution.x / resolution.y), uv.y);

  // 3層スターフィールド（奥ほど小さく遅く暗い＝パララックス）
  float stars = 0.0;
  stars += starLayer(auv, 5.0,  0.015, 0.20) * 0.6; // 遠
  stars += starLayer(auv, 9.0,  0.030, 0.16) * 1.0; // 中
  stars += starLayer(auv, 15.0, 0.055, 0.12) * 1.5; // 近
  // 星の色は進行に応じてやや暖色へ寄せる
  vec3 starCol = mix(vec3(0.85, 0.88, 1.0), vec3(1.0, 0.88, 0.85), clamp(progress, 0.0, 1.0));

  vec3 col = base + starCol * stars;

  // 軽いビネット
  float v = distance(uv, vec2(0.5));
  col *= 1.0 - 0.30 * v * v;

  gl_FragColor = vec4(col, 1.0);
}
`;

export interface ShaderBackground {
  shader: Phaser.GameObjects.Shader;
  /** 難易度進行 t (0..1) を反映 */
  setProgress: (t: number) => void;
}

/**
 * 画面全体を覆う背景シェーダを最背面に追加する。WebGL前提（呼び出し側でガード）。
 */
export function addShaderBackground(scene: Phaser.Scene, depth: number): ShaderBackground {
  const base = new Phaser.Display.BaseShader('dropBg', FRAG, undefined, {
    progress: { type: '1f', value: 0 },
  });

  const shader = scene.add
    .shader(base, GAME.WIDTH / 2, GAME.HEIGHT / 2, GAME.WIDTH, GAME.HEIGHT)
    .setDepth(depth)
    .setScrollFactor(0); // ニアミスのカメラズーム等で背景がブレないよう固定

  return {
    shader,
    setProgress: (t: number) => shader.setUniform('progress.value', t),
  };
}
