import Phaser from 'phaser';
import { GAME } from '../config/balance';
import { ShaderParticles, MAX_PARTICLES } from './shaderParticles';

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
uniform vec3 zoneCool;  // バイオームの基調色（安全時, progress=0）
uniform vec3 zoneHot;   // バイオームの終端色（危険時, progress=1）

uniform vec4 ball;        // x, y, radius, rotation
uniform vec2 ballScale;   // scaleX, scaleY
uniform vec3 ballColor;
uniform vec3 ballGlowColor;
uniform float ballGlowStr;
uniform vec2 ballVel;

uniform vec4 gap;          // leftEdge, rightEdge, y, alpha(0で非表示)
uniform vec3 gapColor;     // ライン/マーカー色（通常水色/息継ぎ緑/警告赤）
uniform float lineGlowStr; // ライングローの強度（呼吸）

// パーティクル（通過バースト/バウンス/常時きらめき/破裂を1ループで合成）
uniform int partCount;                 // 有効粒数（これ以降はbreakで読まない）
uniform vec4 parts[${MAX_PARTICLES}];  // x, y, radius(px), alpha
uniform vec3 partCol[${MAX_PARTICLES}];// r, g, b

uniform int orbitCount;                // ボール周回パーティクルの本数（0〜9, このランの最大コンボ）

varying vec2 fragCoord;

// 背景の基調色/終端色は zoneCool/zoneHot uniform で供給（バイオームで切替）。
// 既定値は青紫→暗い深紅（=従来の COL_START/COL_END 相当, zone0）。

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

// 矩形SDF
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// RGB<->HSV（補色＝色相+0.5 を作るのに使う）
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// 隙間（左右バー + 端マーカー + グロー）を col に合成。alpha=0 なら描かない。
void drawGap(inout vec3 col, vec2 P, vec4 g, vec3 c, float glowStr) {
  float alpha = g.w;
  if (alpha < 0.001) return;
  float leftE = g.x;
  float rightE = g.y;
  float y = g.z;
  float W = resolution.x;
  float hh = 1.5; // LINE_HEIGHT(3)/2
  float dL = sdBox(P - vec2(leftE * 0.5, y), vec2(leftE * 0.5, hh));
  float dR = sdBox(P - vec2((rightE + W) * 0.5, y), vec2((W - rightE) * 0.5, hh));
  float dBar = min(dL, dR);
  float dM = min(length(P - vec2(leftE, y)), length(P - vec2(rightE, y))) - 7.0; // GAP_MARKER_RADIUS
  float dLine = min(dBar, dM);
  col += c * (exp(-max(dLine, 0.0) * 0.06) * glowStr * alpha); // グロー（加算）
  float m = (1.0 - smoothstep(-1.0, 1.0, dLine)) * alpha;      // 塗り
  col = mix(col, c, m);
}

void main(void) {
  vec2 uv = fragCoord / resolution;            // 0..1（y上）

  // ---- 背景 ----
  vec3 base = mix(zoneCool, zoneHot, clamp(progress, 0.0, 1.0));
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

  // モーショントレイル（速度の逆方向へ伸びるカプセル）。classicのゴースト残像に寄せて
  // 早めに立ち上げ・長く・太く・濃くする。
  float sp = length(ballVel);
  float trailAmt = 0.50 * smoothstep(120.0, 480.0, sp);
  if (trailAmt > 0.001) {
    vec2 dir = ballVel / max(sp, 1.0);
    vec2 a = bc;
    vec2 b = bc - dir * min(sp * 0.16, br * 7.0);
    vec2 pa = P - a;
    vec2 ba = b - a;
    float hh = clamp(dot(pa, ba) / max(dot(ba, ba), 1.0), 0.0, 1.0);
    float dCap = length(pa - ba * hh) - br * 0.72;
    float cap = (1.0 - smoothstep(-1.0, 7.0, dCap)) * (1.0 - hh);
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

  // ---- ボールを周回する微粒子（傾いた同心円軌道・軌跡付き・立体）----
  // 軌道面を楕円(y圧縮 cphi)＋ゆっくり歳差(psi)させ、3D的に見せる。各リングで奥行き z∝sin(角度)
  // を判定し、奥(z<0)は orbitBack に、手前(z>0)は orbitFront に分けて貯める。
  // orbitBack はボール本体合成より前に足す→球と重なる所は隠れる＝奥行き（立体）になる。
  vec3 orbitBack = vec3(0.0);
  vec3 orbitFront = vec3(0.0);
  if (br > 1.0) {
    vec2 rel = P - bc;
    // ボール色の補色（色相環で反対）を鮮やかに。同系色だと球と重なって見づらいため。
    vec3 bh = rgb2hsv(ballColor);
    float baseHue = fract(bh.x + 0.5);
    // 本数は orbitCount（このランの最大コンボ, 0〜9）。内側から順に増える。
    for (int i = 0; i < 9; i++) {
      if (i >= orbitCount) break;
      float fi = float(i);
      float orad = br + 16.0 + fi * 3.0;                   // 9本を [br+16, br+40] に詰める
      // 粒の角度（約2倍速・本ごとに少し差）＋角度にsinを足して角速度を揺らがす（本ごとに位相/周期をずらし独立に増減）
      float head = time * (2.2 + fi * 0.22) + fi * 0.7
        + 0.55 * sin(time * (0.7 + fi * 0.05) + fi * 1.3);
      float psi = time * 0.12 + fi * 2.094;                // 軌道面の向き（ゆっくり歳差＝立体的に傾く）
      float cphi = 0.40 + 0.04 * fi;                       // y圧縮率（本ごとに傾きを少し変える）
      // 本ごとに色相・彩度・明度を少しずつ変える（補色を中心に散らす）
      vec3 orbCol = hsv2rgb(vec3(
        fract(baseHue + (fi - 4.0) * 0.022),
        0.80 + 0.12 * sin(fi * 1.7),
        0.82 + 0.15 * cos(fi * 1.1)
      ));
      float cps = cos(psi), sps = sin(psi);
      // ピクセルを軌道ローカルへ（-psi回転→y を1/cphiで戻して円空間に）
      vec2 rr = mat2(cps, -sps, sps, cps) * rel;
      vec2 e = vec2(rr.x, rr.y / max(cphi, 0.05));
      float pr = length(e);
      float pa = atan(e.y, e.x);
      float dr = pr - orad;
      float ring = exp(-dr * dr * 0.06);
      float da = mod(head - pa, 6.2831853);                // 粒の後方への角度差(0..2π)
      float along = 1.0 - clamp(da / 1.7, 0.0, 1.0);       // 1=粒の位置 → 0=尾の端
      float arc = ring * along * along;
      // 先頭の粒（楕円上の位置を +psi 回転して画面へ）
      vec2 dloc = vec2(cos(head) * orad, sin(head) * orad * cphi);
      vec2 hp2 = bc + mat2(cps, sps, -sps, cps) * dloc;
      float hd = length(P - hp2);
      float dotg = exp(-hd * hd * 0.08);
      // 奥行き z ∝ sin(角度)。手前は明るく前面へ、奥は暗くして背面へ（ボールに隠れる）。
      vec3 arcC = orbCol * arc * 0.18;
      vec3 dotC = orbCol * dotg * 0.70;
      if (sin(pa) > 0.0)  orbitFront += arcC * (0.6 + 0.4 * sin(pa)); else orbitBack += arcC * 0.5;
      if (sin(head) > 0.0) orbitFront += dotC * (0.6 + 0.4 * sin(head)); else orbitBack += dotC * 0.5;
    }
  }

  col += ballGlowColor * glow;
  col += orbitBack; // 奥の粒（この後のボール本体合成で球と重なる所は隠れる＝立体）

  // ---- ボール本体（艶のある3D球として陰影付け）----
  float ballMask = 1.0 - smoothstep(-1.5, 1.5, dBall); // 約3pxのAA

  // 画面固定の擬似法線（回転で光が回らないよう、q ではなく画面オフセットで算出）
  vec2 sd = (P - bc) / max(br, 0.001);
  float r2 = clamp(1.0 - dot(sd, sd), 0.0, 1.0);
  float zz = sqrt(r2);
  vec3 N = normalize(vec3(sd, zz + 0.001));
  // 光源は左上から。速度でわずかに傾けて“光が動く”艶を出す
  vec2 ldir = vec2(-0.55, -0.55) + clamp(ballVel * 0.0006, -0.25, 0.25);
  vec3 L = normalize(vec3(ldir, 0.75));

  // ① 内側の陰影グラデ（左上明・右下暗）で立体感
  float diff = clamp(dot(N, L), 0.0, 1.0);
  vec3 body = ballColor * (0.5 + 0.65 * diff);

  // ② 鋭い鏡面ハイライト（濡れ/ガラス感）
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), 48.0);
  body += vec3(1.0) * spec * 0.9;

  // ③ フレネルのリムライト（縁を寒色で淵取り発光）
  float fres = pow(1.0 - zz, 3.0);
  body += vec3(0.55, 0.70, 1.0) * fres * 0.45;

  // ④ アニメするシーン（表面をゆっくり横切る光の帯）
  float band = sin((sd.x - sd.y) * 3.2 - time * 1.6);
  float sheen = smoothstep(0.80, 1.0, band) * r2;
  body += vec3(1.0) * sheen * 0.14;

  // ⑤ 終端色での虹彩（progressが高い＝危険なほど縁が虹色に揺らめく）
  vec3 iridCol = 0.5 + 0.5 * cos(vec3(0.0, 2.094, 4.188) + (sd.x + sd.y) * 4.0 + time * 2.0);
  body += iridCol * (fres * clamp(progress, 0.0, 1.0) * 0.5);

  col = mix(col, body, ballMask);

  col += orbitFront; // 手前の粒（常にボールの前面に重ねる＝立体の前半分）

  // ---- ライン/マーカー（ボールの手前に重ねる＝classic相当）----
  drawGap(col, P, gap, gapColor, lineGlowStr);

  // ---- パーティクル（最前面。classicの各エミッタをまとめてアルファ合成）----
  // ループ上限は配列長で固定。partCount で早期break、alpha≈0はskipして実コストを抑える。
  for (int i = 0; i < ${MAX_PARTICLES}; i++) {
    if (i >= partCount) break;
    vec4 pp = parts[i];
    float pa = pp.w;
    if (pa < 0.004) continue;
    float dP = length(P - pp.xy) - pp.z; // 円SDF
    float pm = (1.0 - smoothstep(-1.0, 1.5, dP)) * pa; // 約2.5pxのAA縁
    col = mix(col, partCol[i], pm);
  }

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

export interface GapState {
  leftEdge: number; rightEdge: number; y: number; alpha: number; color: number;
}

export interface ShaderBackground {
  shader: Phaser.GameObjects.Shader;
  /** シェーダ合成されるパーティクルプール（emit はこちらへ振り分ける） */
  particles: ShaderParticles;
  /** 難易度進行 t (0..1) を反映 */
  setProgress: (t: number) => void;
  /** ボールの状態を反映（毎フレーム） */
  setPlayfield: (s: PlayfieldState) => void;
  /** 隙間（ライン/マーカー）の状態を反映（毎フレーム）。g=null で非表示。 */
  setGap: (g: GapState | null, lineGlowStr: number) => void;
  /** プールを parts/colors バッファへ詰め直し、partCount を更新（毎フレーム） */
  commitParticles: () => void;
  /** バイオームのパレットを反映（基調色 cool / 終端色 hot, ともに 0xRRGGBB） */
  setBiome: (cool: number, hot: number) => void;
  /** ボール周回パーティクルの本数（0〜9）を反映 */
  setOrbitCount: (n: number) => void;
}

/**
 * 画面全体を覆うシーンシェーダ（背景+ボール）を最背面に追加する。WebGL前提（呼び出し側でガード）。
 */
export function addShaderBackground(scene: Phaser.Scene, depth: number): ShaderBackground {
  const particles = new ShaderParticles();

  const base = new Phaser.Display.BaseShader('dropScene', FRAG, undefined, {
    progress: { type: '1f', value: 0 },
    // 既定 zone0（従来の COL_START / COL_END 相当）
    zoneCool: { type: '3f', value: rgb(0x1a1a2e) },
    zoneHot: { type: '3f', value: rgb(0x26050f) },
    ball: { type: '4f', value: { x: GAME.WIDTH / 2, y: GAME.BALL_START_Y, z: GAME.BALL_INITIAL_DIAMETER / 2, w: 0 } },
    ballScale: { type: '2f', value: { x: 1, y: 1 } },
    ballColor: { type: '3f', value: rgb(GAME.BALL_COLOR_START) },
    ballGlowColor: { type: '3f', value: rgb(GAME.BALL_COLOR_START) },
    ballGlowStr: { type: '1f', value: 0 },
    ballVel: { type: '2f', value: { x: 0, y: 0 } },
    gap: { type: '4f', value: { x: 0, y: GAME.WIDTH, z: GAME.LINE_Y, w: 0 } },
    gapColor: { type: '3f', value: rgb(GAME.LINE_COLOR) },
    lineGlowStr: { type: '1f', value: 0 },
    // パーティクル: バッファ参照をそのまま渡す（in-place更新を毎レンダー読む）。
    partCount: { type: '1i', value: 0 },
    parts: { type: '4fv', value: particles.parts },
    partCol: { type: '3fv', value: particles.colors },
    orbitCount: { type: '1i', value: 0 },
  });

  // 注: scrollFactor は既定(1,1)のまま。ニアミスのカメラズーム時に背景+ボールが
  //     ライン/パーティクルと一緒に拡縮するよう、あえて固定しない。
  const shader = scene.add
    .shader(base, GAME.WIDTH / 2, GAME.HEIGHT / 2, GAME.WIDTH, GAME.HEIGHT)
    .setDepth(depth);

  return {
    shader,
    particles,
    commitParticles: () => shader.setUniform('partCount.value', particles.writeBuffers()),
    setBiome: (cool: number, hot: number) => {
      shader.setUniform('zoneCool.value', rgb(cool));
      shader.setUniform('zoneHot.value', rgb(hot));
    },
    setOrbitCount: (n: number) => shader.setUniform('orbitCount.value', Math.max(0, Math.min(9, Math.round(n)))),
    setProgress: (t: number) => shader.setUniform('progress.value', t),
    setPlayfield: (s: PlayfieldState) => {
      shader.setUniform('ball.value', { x: s.x, y: s.y, z: s.radius, w: s.rot });
      shader.setUniform('ballScale.value', { x: s.scaleX, y: s.scaleY });
      shader.setUniform('ballColor.value', rgb(s.color));
      shader.setUniform('ballGlowColor.value', rgb(s.glowColor));
      shader.setUniform('ballGlowStr.value', s.glowStr);
      shader.setUniform('ballVel.value', { x: s.velX, y: s.velY });
    },
    setGap: (g: GapState | null, lineGlowStr: number) => {
      if (g) {
        shader.setUniform('gap.value', { x: g.leftEdge, y: g.rightEdge, z: g.y, w: g.alpha });
        shader.setUniform('gapColor.value', rgb(g.color));
      } else {
        shader.setUniform('gap.value', { x: 0, y: GAME.WIDTH, z: GAME.LINE_Y, w: 0 });
      }
      shader.setUniform('lineGlowStr.value', lineGlowStr);
    },
  };
}
