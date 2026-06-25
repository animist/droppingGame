import Phaser from 'phaser';
import { GAME } from '../config/balance';

/**
 * シーンシェーダ（背景 + ボールのプレイフィールド）。
 *
 * Phaser の Shader GameObject はアルファ合成が不定なため、透明オーバーレイ方式は採らず
 * 「背景 → トレイル → グロー → ボール本体 → ハイライト」を1枚の不透明シェーダ内で正しい順に
 * 合成する。ライン/マーカー/パーティクル/文字は従来通り Phaser オブジェクトとして上に重ねる。
 *
 * uniform:
 *  - 自動: time / resolution（Phaser が供給・更新）
 *  - 背景: progress(1f)
 *  - ボール: ball(4f=x,y,r,rot) / ballScale(2f) / ballColor(3f) / ballGlowColor(3f)
 *           / ballGlowStr(1f) / ballVel(2f)
 *
 * モバイル注意: precision は highp（mediumpの16bitでInf/NaN→黒画面回避）。fwidth不使用、
 *   smoothstepは必ず edge0<edge1、組み込み名(dot等)と変数衝突させない、0除算はmaxで回避。
 */

// balance.ts と同期: BG_COLOR_START=0x1a1a2e, BG_COLOR_END=0x4a081f
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform float time;
uniform vec2 resolution;
uniform float progress;

uniform vec4 ball;        // x, y, radius, rotation
uniform vec2 ballScale;   // scaleX, scaleY
uniform vec3 ballColor;
uniform vec3 ballGlowColor;
uniform float ballGlowStr;
uniform vec2 ballVel;

varying vec2 fragCoord;

const vec3 COL_START = vec3(0.102, 0.102, 0.180); // 青紫
// ピンチ時の終端色。赤すぎてボールが埋もれないよう暗いトーンの深紅にする
// （shader用の調整値。classicの BG_COLOR_END とは意図的に別）
const vec3 COL_END   = vec3(0.150, 0.020, 0.060); // 暗い深紅

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float starLayer(vec2 uv, float scale, float speed, float density) {
  uv.y -= time * speed;          // 下→上（上方向）へ流れる
  uv *= scale;
  vec2 cell = floor(uv);
  vec2 f = fract(uv) - 0.5;
  float h = hash21(cell);
  float on = step(1.0 - density, h);
  vec2 jitter = (vec2(hash21(cell + 1.7), hash21(cell + 3.3)) - 0.5) * 0.6;
  float d = length(f - jitter);
  float spark = 1.0 - smoothstep(0.0, 0.09, d); // 小さめの点
  float tw = 0.6 + 0.4 * sin(time * (1.0 + h * 2.0) + h * 6.28);
  return spark * on * tw;
}

void main(void) {
  vec2 uv = fragCoord / resolution;            // 0..1（y上）

  // ---- 背景 ----
  vec3 base = mix(COL_START, COL_END, clamp(progress, 0.0, 1.0));
  base *= mix(0.90, 1.20, uv.y);
  float neb = sin(uv.x * 4.0 + time * 0.05) * sin(uv.y * 3.0 - time * 0.04);
  base += mix(vec3(0.04, 0.05, 0.10), vec3(0.06, 0.015, 0.03), clamp(progress, 0.0, 1.0))
          * (0.5 + 0.5 * neb);
  vec2 auv = vec2(uv.x * (resolution.x / resolution.y), uv.y);
  float stars = 0.0;
  stars += starLayer(auv, 6.0,  0.015, 0.14) * 0.25; // 遠（暗め・控えめ）
  stars += starLayer(auv, 11.0, 0.030, 0.11) * 0.40; // 中
  stars += starLayer(auv, 17.0, 0.055, 0.08) * 0.60; // 近
  vec3 starCol = mix(vec3(0.85, 0.88, 1.0), vec3(1.0, 0.88, 0.85), clamp(progress, 0.0, 1.0));
  vec3 col = base + starCol * stars;
  float vg = distance(uv, vec2(0.5));
  col *= 1.0 - 0.30 * vg * vg;

  // ---- プレイフィールド（ボール）----
  // ゲーム空間ピクセル座標（y下＝Phaserのワールドと一致）
  vec2 P = vec2(fragCoord.x, resolution.y - fragCoord.y);
  vec2 bc = ball.xy;
  float br = ball.z;
  float brot = ball.w;

  // モーショントレイル（速度の逆方向へ伸びるカプセル）
  float sp = length(ballVel);
  float trailAmt = 0.30 * smoothstep(150.0, 600.0, sp);
  if (trailAmt > 0.001) {
    vec2 dir = ballVel / max(sp, 1.0);
    vec2 a = bc;
    vec2 b = bc - dir * min(sp * 0.12, br * 5.0);
    vec2 pa = P - a;
    vec2 ba = b - a;
    float hh = clamp(dot(pa, ba) / max(dot(ba, ba), 1.0), 0.0, 1.0);
    float dCap = length(pa - ba * hh) - br * 0.6;
    float cap = (1.0 - smoothstep(-1.0, 6.0, dCap)) * (1.0 - hh);
    col += ballColor * cap * trailAmt;
  }

  // ボールローカル系へ（-brot 回転 → スケール解除）。スケールで簡易な楕円化（スクワッシュ）。
  vec2 q = P - bc;
  float ca = cos(brot), sa = sin(brot);
  q = mat2(ca, -sa, sa, ca) * q;
  q /= max(ballScale, vec2(0.001));
  float dBall = length(q) - br;

  // グロー（ボールの背後・加算）
  float glow = exp(-max(dBall, 0.0) * 0.05) * ballGlowStr;
  col += ballGlowColor * glow;

  // ボール本体（約3pxのAAで縁をなめらかに）
  float ballMask = 1.0 - smoothstep(-1.5, 1.5, dBall);
  col = mix(col, ballColor, ballMask);

  // 左上の白ハイライト（球体感）。ボール内側にのみ乗せる
  vec2 hp = bc + vec2(-0.30 * br, -0.30 * br);
  float dh = length(P - hp) - br * 0.30;
  float hl = (1.0 - smoothstep(-1.0, 1.0, dh)) * ballMask * 0.45;
  col += vec3(1.0) * hl;

  gl_FragColor = vec4(col, 1.0);
}
`;

function rgb(n: number) {
  return { x: ((n >> 16) & 255) / 255, y: ((n >> 8) & 255) / 255, z: (n & 255) / 255 };
}

export interface PlayfieldState {
  x: number; y: number; radius: number; rot: number;
  scaleX: number; scaleY: number;
  color: number; glowColor: number; glowStr: number;
  velX: number; velY: number;
}

export interface ShaderBackground {
  shader: Phaser.GameObjects.Shader;
  /** 難易度進行 t (0..1) を反映 */
  setProgress: (t: number) => void;
  /** ボールの状態を反映（毎フレーム） */
  setPlayfield: (s: PlayfieldState) => void;
}

/**
 * 画面全体を覆うシーンシェーダ（背景+ボール）を最背面に追加する。WebGL前提（呼び出し側でガード）。
 */
export function addShaderBackground(scene: Phaser.Scene, depth: number): ShaderBackground {
  const base = new Phaser.Display.BaseShader('dropScene', FRAG, undefined, {
    progress: { type: '1f', value: 0 },
    ball: { type: '4f', value: { x: GAME.WIDTH / 2, y: GAME.BALL_START_Y, z: GAME.BALL_INITIAL_DIAMETER / 2, w: 0 } },
    ballScale: { type: '2f', value: { x: 1, y: 1 } },
    ballColor: { type: '3f', value: rgb(GAME.BALL_COLOR_START) },
    ballGlowColor: { type: '3f', value: rgb(GAME.BALL_COLOR_START) },
    ballGlowStr: { type: '1f', value: 0 },
    ballVel: { type: '2f', value: { x: 0, y: 0 } },
  });

  // 注: scrollFactor は既定(1,1)のまま。ニアミスのカメラズーム時に背景+ボールが
  //     ライン/パーティクルと一緒に拡縮するよう、あえて固定しない。
  const shader = scene.add
    .shader(base, GAME.WIDTH / 2, GAME.HEIGHT / 2, GAME.WIDTH, GAME.HEIGHT)
    .setDepth(depth);

  return {
    shader,
    setProgress: (t: number) => shader.setUniform('progress.value', t),
    setPlayfield: (s: PlayfieldState) => {
      shader.setUniform('ball.value', { x: s.x, y: s.y, z: s.radius, w: s.rot });
      shader.setUniform('ballScale.value', { x: s.scaleX, y: s.scaleY });
      shader.setUniform('ballColor.value', rgb(s.color));
      shader.setUniform('ballGlowColor.value', rgb(s.glowColor));
      shader.setUniform('ballGlowStr.value', s.glowStr);
      shader.setUniform('ballVel.value', { x: s.velX, y: s.velY });
    },
  };
}
