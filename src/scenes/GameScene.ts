import Phaser from 'phaser';
import { GAME, STORAGE_KEYS } from '../config/balance';
import { FONT_FAMILY } from '../config/ui';
import { tilt } from '../input/tilt';
import { playBounce, playWall, playPass, playGameOver, playPerfectPass, playNearMiss, playMilestone, playBestBeaten, setMusicMuffled, updateFallSound, muteFallSound } from '../audio/sfx';
import { startMusic, stopMusic, tapeStopMusic, setMusicIntensity, intensityFromScore } from '../audio/music';
import { vibrate } from '../input/haptics';
import { lerpColor, brighten } from '../util/color';
import { addBackgroundShade, addWarningVignette } from '../util/bgShade';
import { getQuality } from '../config/quality';
import { enableWakeLock, disableWakeLock } from '../util/wakelock';

export class GameScene extends Phaser.Scene {
  private ball!: Phaser.GameObjects.Arc;
  private ballHighlight!: Phaser.GameObjects.Arc;  // 球体感を出す左上ハイライト
  private leftLine!: Phaser.GameObjects.Rectangle;
  private rightLine!: Phaser.GameObjects.Rectangle;
  private leftMarker!: Phaser.GameObjects.Arc;     // 隙間の左端を示す発光点
  private rightMarker!: Phaser.GameObjects.Arc;    // 隙間の右端を示す発光点

  private gapBase = GAME.GAP_INITIAL;   // 決定論的な基準隙間幅（単調に縮む。難易度カーブの本体）
  private gapWidth = GAME.GAP_INITIAL;   // 表示/判定用の実効隙間幅（基準幅±ジッタ）
  private stageCount = 0;                // 通過したステージ数（息継ぎリズムの判定に使う）
  private gapCenterX = GAME.WIDTH / 2;
  private ballDiameter = GAME.BALL_INITIAL_DIAMETER;
  private score = 0;
  private scoreText!: Phaser.GameObjects.Text;
  private hasPassedGap = false;
  private isGameOver = false;
  private isScrolling = false;
  private pointerLastX: number | null = null;
  private bgProgress = 0;
  private trailTimer = 0;
  private ambientTimer = 0;            // 常時パーティクルの生成タイマー
  private warningActive = false;
  private warningTween: Phaser.Tweens.Tween | null = null;
  private warnVignette: Phaser.GameObjects.Image | null = null;   // 警告中に脈動する赤ビネット
  private warnVignetteTween: Phaser.Tweens.Tween | null = null;
  private guideTexts: Phaser.GameObjects.Text[] = [];             // 初回プレイの操作ガイド
  private bounceCount = 0;
  private perfectStreak = 0;
  private perfectCount = 0;          // このプレイでのPERFECT総数（リザルト内訳用）
  private maxPerfectStreak = 0;      // PERFECT最大連続数（リザルト内訳用）
  private nearMissCount = 0;         // CLOSE（ニアミス通過）総数（リザルト内訳用）
  private prevBest = 0;              // プレイ開始時点の自己ベスト（ベスト超え演出用）
  private bestBeaten = false;        // ベスト超え演出を発動済みか
  private gammaRest = 0;        // 持ち方の傾き癖を吸収するための中立値
  private gammaCalibrated = false;
  // グローは全画面 postFX ではなく、焼いた放射グラデを加算ブレンドした Image で表現する
  // （postFX は全画面パスでフィルレートを最も食うため）。strength は alpha にマップ。
  private ballGlow: Phaser.GameObjects.Image | null = null;
  private ballGlowBase = GAME.GLOW_BALL_BASE;  // 色の進行度で決まるグロー基準強度（揺らぎ前）
  private lineGlows: Phaser.GameObjects.Image[] = [];   // 呼吸パルス用（ライン+マーカー）
  private leftLineGlow!: Phaser.GameObjects.Image;
  private rightLineGlow!: Phaser.GameObjects.Image;
  private leftMarkerGlow!: Phaser.GameObjects.Image;
  private rightMarkerGlow!: Phaser.GameObjects.Image;
  private parallaxDots: { obj: Phaser.GameObjects.Image; speed: number; ratio: number }[] = [];
  private musicIntensity = 0;
  private scrollProxy = { y: 0 };       // ライン上昇に同期する仮想スクロール位置
  private scrollPrevY = 0;
  private parallaxScrolling = false;
  private nextMilestoneIdx = 0;         // 次に到達すべきマイルストーンのインデックス
  private frozen = false;               // ニアミスのストップモーション中フラグ
  // ニアミスのピボット固定ズーム状態
  private nmActive = false;
  private nmElapsed = 0;
  private nmPivotX = 0;
  private nmPivotY = 0;
  private nmText: Phaser.GameObjects.Text | null = null;
  // パーティクルは GameObject の生成/破棄を避けるため ParticleEmitter で使い回す
  private burstEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;   // 通過時の放射バースト
  private bounceEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;  // バウンス時の上向きバースト
  private trailEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;   // ボールの残像トレイル
  private ambientEmitter!: Phaser.GameObjects.Particles.ParticleEmitter; // 落下中の常時きらめき
  private deathEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;   // 死亡時のボール破裂
  // ↓ emitParticleAt 直前にセットして onEmit から読む、粒ごとの可変パラメータ
  private ambTint = 0xffffff;
  private ambToX = 0;
  private ambToY = 0;
  private deathColor = 0xffffff;
  // 傾きインジケーター（水準器）。tilt 入力の状態を可視化
  private tiltIndicator: Phaser.GameObjects.Container | null = null;
  private tiltBubble: Phaser.GameObjects.Arc | null = null;
  private tiltHalfTravel = 0; // 泡が中央から端まで動ける距離(px)

  private static readonly PARTICLE_TEXTURE = 'particleDot';
  private static readonly PARTICLE_TEX_RADIUS = 16; // 焼く円テクスチャの半径(px)。実表示はscaleで縮小
  private static readonly GLOW_TEXTURE = 'glowSoft';
  private static readonly GLOW_TEX_RADIUS = 64;     // 放射グラデの半径(px)。実表示はscaleで拡縮

  constructor() {
    super('Game');
  }

  create() {
    this.gapBase = GAME.GAP_INITIAL;
    this.gapWidth = GAME.GAP_INITIAL; // 初回ステージはジッタ無しで素直に開始
    this.stageCount = 0;
    this.gapCenterX = GAME.WIDTH / 2;
    this.ballDiameter = GAME.BALL_INITIAL_DIAMETER;
    this.score = 0;
    this.hasPassedGap = false;
    this.isGameOver = false;
    this.isScrolling = false;
    this.pointerLastX = null;
    this.bgProgress = 0;
    this.trailTimer = 0;
    this.ambientTimer = 0;
    this.warningActive = false;
    this.warningTween = null;
    this.warnVignette = null;
    this.warnVignetteTween = null;
    this.guideTexts = [];
    this.bounceCount = 0;
    this.perfectStreak = 0;
    this.perfectCount = 0;
    this.maxPerfectStreak = 0;
    this.nearMissCount = 0;
    this.bestBeaten = false;
    try {
      this.prevBest = Number(localStorage.getItem(STORAGE_KEYS.HIGH_SCORE) ?? 0);
    } catch {
      this.prevBest = 0;
    }
    this.gammaRest = 0;
    this.gammaCalibrated = false;
    this.ballGlow = null;
    this.lineGlows = [];
    this.parallaxScrolling = false;
    this.nextMilestoneIdx = 0;
    this.frozen = false;
    this.nmActive = false;
    this.nmText = null;
    this.cameras.main.setZoom(1);
    this.cameras.main.setScroll(0, 0);
    this.time.timeScale = 1;
    this.tweens.timeScale = 1;
    if (this.physics.world) this.physics.world.timeScale = 1;
    // 200ms 後に傾きセンサーの現在値を「中立」として記録（端末を構える角度の癖を吸収）
    this.time.delayedCall(200, () => {
      if (tilt.enabled) this.gammaRest = tilt.value;
      this.gammaCalibrated = true;
    });
    this.cameras.main.setBackgroundColor(GAME.BG_COLOR_START);

    this.createParticles(); // 円テクスチャの生成を含むので先に呼ぶ（パララックスが使う）
    this.createParallax();
    // パララックス(-10)の手前・ゲームプレイ要素の奥に敷き、ドットごと薄く沈めて奥行きを出す
    addBackgroundShade(this, -9);
    // 警告用の赤ビネット（alpha 0 で常駐、警告中だけ脈動）
    this.warnVignette = addWarningVignette(this, 930);

    this.scoreText = this.add.text(GAME.WIDTH / 2, 100, '0', {
      fontFamily: FONT_FAMILY,
      fontSize: '120px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0.5);

    this.physics.world.setBoundsCollision(true, true, false, false);
    this.createBall();
    this.randomizeGapCenter();
    this.createLines();
    this.updateBallColor(); // 初期の穴比率に応じた色を反映
    this.createTiltIndicator();
    // 傾き操作中はタッチが無く OS にスリープされやすいので画面スリープを抑止
    // （タイトルのタップで遷移してきた直後＝ユーザー操作の有効期間内に要求）
    enableWakeLock();

    // BGM 開始（前回の警告こもりが残らないようフィルタを開いておく）
    this.musicIntensity = 0;
    setMusicIntensity(0);
    setMusicMuffled(false);
    startMusic();
    this.events.once('shutdown', () => stopMusic());
    this.setupInput();

    // 初回プレイ（累計プレイ回数 0）のときだけ操作ガイドを表示
    let playCount = 1;
    try {
      playCount = Number(localStorage.getItem(STORAGE_KEYS.PLAY_COUNT) ?? 0);
    } catch {
      playCount = 1; // localStorage 不可なら毎回出さない側に倒す
    }
    if (playCount === 0) this.createFirstPlayGuide();
  }

  // 初回プレイの操作ガイド（最初の通過 or ゲームオーバーで消える）
  private createFirstPlayGuide() {
    const cx = GAME.WIDTH / 2;
    const y = 760;
    const style = (size: string, color = '#ffffff') => ({
      fontFamily: FONT_FAMILY,
      fontSize: size,
      color,
      fontStyle: 'bold',
      padding: { top: 6, bottom: 4 },
    });
    const left = this.add.text(cx - 250, y, '←', style('48px')).setOrigin(0.5).setDepth(970).setAlpha(0.9);
    const right = this.add.text(cx + 250, y, '→', style('48px')).setOrigin(0.5).setDepth(970).setAlpha(0.9);
    const msg = this.add.text(cx, y, 'スワイプ / かたむけ', style('34px')).setOrigin(0.5).setDepth(970).setAlpha(0.9);
    const sub = this.add.text(cx, y + 64, 'たまを すきまに とおそう', style('28px', '#aaaadd')).setOrigin(0.5).setDepth(970).setAlpha(0.85);
    this.guideTexts = [left, right, msg, sub];

    this.tweens.add({
      targets: left, x: '-=24', duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    this.tweens.add({
      targets: right, x: '+=24', duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
  }

  private dismissGuide() {
    if (!this.guideTexts.length) return;
    const texts = this.guideTexts;
    this.guideTexts = [];
    for (const t of texts) this.tweens.killTweensOf(t);
    this.tweens.add({
      targets: texts,
      alpha: 0,
      duration: 400,
      ease: 'Quad.easeOut',
      onComplete: () => texts.forEach((t) => t.destroy()),
    });
  }

  private createBall() {
    const radius = this.ballDiameter / 2;
    this.ball = this.add.circle(GAME.WIDTH / 2, GAME.BALL_START_Y, radius, GAME.BALL_COLOR);
    this.physics.add.existing(this.ball);
    const body = this.ball.body as Phaser.Physics.Arcade.Body;
    body.setCircle(radius);
    body.setBounce(GAME.WALL_BOUNCE, GAME.BOUNCE);
    body.setDragX(GAME.DRAG_X);
    body.setCollideWorldBounds(true);
    body.setMaxVelocity(GAME.MAX_VELOCITY, GAME.MAX_VELOCITY);
    body.onWorldBounds = true;
    this.physics.world.on('worldbounds', this.onWallBounce, this);
    // ボールの下に敷く加算グロー（postFXパスの代替）。位置/大きさ/色/alphaは毎フレーム追従。
    this.ballGlow = this.makeGlowSprite(
      brighten(GAME.BALL_COLOR_START, GAME.GLOW_BALL_BRIGHTEN),
      -0.5, // ボール(0)とトレイル(-1)の間
    );
    if (this.ballGlow) this.ballGlow.setAlpha(this.glowAlpha(GAME.GLOW_BALL_BASE));
    this.syncBallGlow();
    // 左上の白ハイライト（ボール直後に生成して常にボールの上へ重ねる）。位置・大きさは update で追従
    this.ballHighlight = this.add.circle(
      this.ball.x - radius * 0.35, this.ball.y - radius * 0.35,
      Math.max(2, radius * 0.28), 0xffffff, 0.3,
    );
  }

  // ハイライトをボールの現在位置・変形（スクワッシュ／ストレッチ含む）に追従させる
  private syncBallHighlight() {
    if (!this.ballHighlight || !this.ball) return;
    const r = this.ballDiameter / 2;
    // オフセットは「光源が左上」の世界座標固定。大きさだけ平均スケールでならす
    const meanScale = (this.ball.scaleX + this.ball.scaleY) / 2;
    this.ballHighlight.setPosition(
      this.ball.x - r * 0.35 * meanScale,
      this.ball.y - r * 0.35 * meanScale,
    );
    this.ballHighlight.setRadius(Math.max(2, r * 0.28));
    this.ballHighlight.setRotation(this.ball.rotation);
    this.ballHighlight.setScale(this.ball.scaleX, this.ball.scaleY);
  }

  // グロースプライトをボールの現在位置・大きさへ追従させる（色とalphaは別途 updateBallColor/update で）
  private syncBallGlow() {
    if (!this.ballGlow) return;
    const r = this.ballDiameter / 2;
    const meanScale = (this.ball.scaleX + this.ball.scaleY) / 2;
    // 視覚半径 ≈ ボール半径 + 拡散距離。テクスチャ半径基準でスケール化
    const radius = r * meanScale + GAME.GLOW_BALL_DISTANCE;
    this.ballGlow.setPosition(this.ball.x, this.ball.y);
    this.ballGlow.setScale(radius / GameScene.GLOW_TEX_RADIUS);
  }

  // 移動速度に応じてボールを進行方向に伸ばす（速いほど細長く）。
  // スクワッシュ等の tween 中はそちらを優先する。
  private applyVelocityStretch(body: Phaser.Physics.Arcade.Body) {
    if (this.tweens.isTweening(this.ball)) return;
    const speed = Math.hypot(body.velocity.x, body.velocity.y);
    if (speed > GAME.STRETCH_MIN_SPEED) {
      const t = Math.min(
        1,
        (speed - GAME.STRETCH_MIN_SPEED) / (GAME.STRETCH_MAX_SPEED - GAME.STRETCH_MIN_SPEED),
      );
      const s = GAME.STRETCH_MAX * t;
      // 回転＝進行方向。ローカルX軸（scaleX）が進行方向に対応する
      this.ball.setRotation(Math.atan2(body.velocity.y, body.velocity.x));
      this.ball.setScale(1 + s, 1 - s * 0.6);
    } else {
      this.ball.setRotation(0);
      this.ball.setScale(1);
    }
  }

  // 背景の3層パララックス（奥行き感のあるドット群）
  // ratio: ライン上昇スクロールに連動する際の追従率（近景=1.0でライン速度に一致、遠景ほど小さく＝視差）
  // 個別 Arc(=ドローコール多数) ではなく、焼いた円テクスチャの Image(tint/scale) を使い
  // 同一テクスチャで WebGL バッチ描画に載せる。
  private createParallax() {
    this.parallaxDots = [];
    const R = GameScene.PARTICLE_TEX_RADIUS;
    const tex = GameScene.PARTICLE_TEXTURE;
    const layers = [
      { count: GAME.PARALLAX_FAR_COUNT, size: 2, alpha: 0.12, speed: 14, color: 0x8888aa, ratio: 0.25 },
      { count: GAME.PARALLAX_MID_COUNT, size: 3, alpha: 0.20, speed: 32, color: 0xaaaacc, ratio: 0.55 },
      { count: GAME.PARALLAX_NEAR_COUNT, size: 5, alpha: 0.28, speed: 60, color: 0xccccee, ratio: 1.0 },
    ];
    for (const L of layers) {
      for (let i = 0; i < L.count; i++) {
        const dot = this.add.image(
          Phaser.Math.Between(0, GAME.WIDTH),
          Phaser.Math.Between(0, GAME.HEIGHT),
          tex,
        )
          .setScale(L.size / R) // テクスチャ半径Rの円を size px相当へ縮小
          .setTint(L.color)
          .setAlpha(L.alpha)
          .setDepth(-10);
        this.parallaxDots.push({ obj: dot, speed: L.speed, ratio: L.ratio });
      }
    }
  }

  private updateParallax(delta: number) {
    const dt = delta / 1000;
    // ライン上昇に同期した追加スクロール量（px、上方向）
    let scrollDelta = 0;
    if (this.parallaxScrolling) {
      scrollDelta = this.scrollPrevY - this.scrollProxy.y;
      this.scrollPrevY = this.scrollProxy.y;
    }
    for (const p of this.parallaxDots) {
      // 常時のゆるやかな上方向ドリフト + ライン同期スクロール（層ごとの視差を保つ）
      p.obj.y -= p.speed * GAME.PARALLAX_DRIFT_SPEED * dt;
      if (scrollDelta !== 0) p.obj.y -= scrollDelta * p.ratio;
      // 画面外に出たら反対側へ循環
      if (p.obj.y < -8) {
        p.obj.y += GAME.HEIGHT + 16;
        p.obj.x = Phaser.Math.Between(0, GAME.WIDTH);
      } else if (p.obj.y > GAME.HEIGHT + 8) {
        p.obj.y -= GAME.HEIGHT + 16;
        p.obj.x = Phaser.Math.Between(0, GAME.WIDTH);
      }
    }
  }

  // 中心が明るく外周で透明になる放射グラデを1枚焼く。加算ブレンドのグロー素材に使う。
  private bakeGlowTexture() {
    const key = GameScene.GLOW_TEXTURE;
    if (this.textures.exists(key)) return;
    const size = GameScene.GLOW_TEX_RADIUS * 2;
    const canvas = this.textures.createCanvas(key, size, size);
    if (!canvas) return;
    const ctx = canvas.getContext();
    const c = size / 2;
    const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    canvas.refresh();
  }

  // 加算ブレンドのグロースプライトを1枚生成（postFXパスの代替）。
  // low ティアではグロー無しなので null を返す。
  private makeGlowSprite(color: number, depth: number): Phaser.GameObjects.Image | null {
    if (!getQuality().glow) return null;
    return this.add.image(0, 0, GameScene.GLOW_TEXTURE)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(color)
      .setDepth(depth);
  }

  // glow 強度(旧 outerStrength 相当)→加算スプライトの alpha。最大16で飽和。
  private glowAlpha(strength: number): number {
    return Math.max(0, Math.min(1, strength / 16));
  }

  // 傾き入力の状態を見せる水準器。中央に無入力の安全帯(デッドゾーン)、泡が現在の傾きを示す。
  private createTiltIndicator() {
    const w = GAME.TILT_IND_WIDTH;
    const h = GAME.TILT_IND_HEIGHT;
    // 泡が動ける片側距離（トラック内に収める）
    this.tiltHalfTravel = w / 2 - GAME.TILT_IND_BUBBLE_RADIUS - 6;
    const dzHalfPx = (GAME.TILT_DEAD_ZONE_DEG / GAME.TILT_IND_MAX_DEG) * this.tiltHalfTravel;

    const track = this.add.rectangle(0, 0, w, h, GAME.TILT_IND_TRACK_COLOR, 0.9);
    const deadZone = this.add.rectangle(0, 0, dzHalfPx * 2, h - 6, GAME.TILT_IND_DEADZONE_COLOR, 0.9);
    const neutralTick = this.add.rectangle(0, 0, 2, h, 0xffffff, 0.5); // 中立(キャリブ基準)目盛り
    this.tiltBubble = this.add.circle(0, 0, GAME.TILT_IND_BUBBLE_RADIUS, GAME.TILT_IND_BUBBLE_NEUTRAL);

    this.tiltIndicator = this.add
      .container(GAME.TILT_IND_X, GAME.TILT_IND_Y, [track, deadZone, neutralTick, this.tiltBubble])
      .setDepth(970)
      .setAlpha(GAME.TILT_IND_ALPHA)
      .setVisible(tilt.enabled); // 傾き操作が有効な時だけ表示（スワイプ運用時は隠す）
  }

  // 泡の位置と色を現在の傾き(中立からのズレ)に合わせて更新する。
  private updateTiltIndicator() {
    const ind = this.tiltIndicator;
    if (!ind || !this.tiltBubble) return;
    const active = tilt.enabled && this.gammaCalibrated;
    if (ind.visible !== active) ind.setVisible(active);
    if (!active) return;

    const tiltX = tilt.value - this.gammaRest;
    const norm = Phaser.Math.Clamp(tiltX / GAME.TILT_IND_MAX_DEG, -1, 1);
    this.tiltBubble.x = norm * this.tiltHalfTravel;
    // デッドゾーン内＝無入力(グレー)、外＝力が効いている(シアン＋拡大)
    const inDeadZone = Math.abs(tiltX) < GAME.TILT_DEAD_ZONE_DEG;
    this.tiltBubble.setFillStyle(
      inDeadZone ? GAME.TILT_IND_BUBBLE_NEUTRAL : GAME.TILT_IND_BUBBLE_ACTIVE,
    );
    // 状態に応じた目標スケールへ毎フレーム補間（snapせず滑らかに膨らむ）
    const targetScale = inDeadZone ? 1 : GAME.TILT_IND_BUBBLE_ACTIVE_SCALE;
    this.tiltBubble.scale += (targetScale - this.tiltBubble.scale) * 0.25;
  }

  private createLines() {
    const gapHalf = this.gapWidth / 2;
    const leftSegWidth = this.gapCenterX - gapHalf;
    const rightSegWidth = GAME.WIDTH - (this.gapCenterX + gapHalf);
    const y = GAME.LINE_Y;

    this.leftLine = this.add.rectangle(
      leftSegWidth / 2, y,
      leftSegWidth, GAME.LINE_HEIGHT,
      GAME.LINE_COLOR,
    );
    this.rightLine = this.add.rectangle(
      this.gapCenterX + gapHalf + rightSegWidth / 2, y,
      rightSegWidth, GAME.LINE_HEIGHT,
      GAME.LINE_COLOR,
    );

    this.physics.add.existing(this.leftLine, true);
    this.physics.add.existing(this.rightLine, true);

    // 隙間の端を示す発光マーカー（端の視認性UP）。位置は oscillateLines で追従
    this.leftMarker = this.add.circle(
      leftSegWidth, y, GAME.GAP_MARKER_RADIUS, GAME.GAP_MARKER_COLOR,
    );
    this.rightMarker = this.add.circle(
      this.gapCenterX + gapHalf, y, GAME.GAP_MARKER_RADIUS, GAME.GAP_MARKER_COLOR,
    );

    // ライン/マーカーの加算グロー（postFXパスの代替）。位置・大きさは oscillateLines で追従、
    // alpha 呼吸は update で lineGlows をまとめて更新。色は旧 Glow 既定に合わせ白。
    this.lineGlows = [];
    const a0 = this.glowAlpha(GAME.GLOW_LINE);
    const ll = this.makeGlowSprite(0xffffff, -0.5);
    const rl = this.makeGlowSprite(0xffffff, -0.5);
    const lm = this.makeGlowSprite(0xffffff, -0.5);
    const rm = this.makeGlowSprite(0xffffff, -0.5);
    // 非nullなら参照保持＋初期alpha＋初期同期。null(lowティア)時は never 代入を避ける
    if (ll) { this.leftLineGlow = ll.setAlpha(a0); this.lineGlows.push(ll); }
    if (rl) { this.rightLineGlow = rl.setAlpha(a0); this.lineGlows.push(rl); }
    if (lm) { this.leftMarkerGlow = lm.setAlpha(a0); this.lineGlows.push(lm); }
    if (rm) { this.rightMarkerGlow = rm.setAlpha(a0); this.lineGlows.push(rm); }
    this.syncLineGlows();

    this.physics.add.collider(this.ball, this.leftLine, () => this.onBounce());
    this.physics.add.collider(this.ball, this.rightLine, () => this.onBounce());
  }

  // ライン/マーカーのグロースプライトを各オーナーの現在の位置・大きさへ合わせる。
  private syncLineGlows() {
    const D = GameScene.GLOW_TEX_RADIUS * 2; // テクスチャ径
    if (this.leftLineGlow && this.leftLine) {
      this.leftLineGlow.setPosition(this.leftLine.x, this.leftLine.y);
      this.leftLineGlow.setScale(
        (this.leftLine.width + GAME.GLOW_DISTANCE * 2) / D,
        (GAME.LINE_HEIGHT + GAME.GLOW_DISTANCE * 2) / D,
      );
    }
    if (this.rightLineGlow && this.rightLine) {
      this.rightLineGlow.setPosition(this.rightLine.x, this.rightLine.y);
      this.rightLineGlow.setScale(
        (this.rightLine.width + GAME.GLOW_DISTANCE * 2) / D,
        (GAME.LINE_HEIGHT + GAME.GLOW_DISTANCE * 2) / D,
      );
    }
    const mScale = (GAME.GAP_MARKER_RADIUS * 2 + GAME.GLOW_DISTANCE * 2) / D;
    if (this.leftMarkerGlow && this.leftMarker) {
      this.leftMarkerGlow.setPosition(this.leftMarker.x, this.leftMarker.y).setScale(mScale);
    }
    if (this.rightMarkerGlow && this.rightMarker) {
      this.rightMarkerGlow.setPosition(this.rightMarker.x, this.rightMarker.y).setScale(mScale);
    }
  }

  private oscillateLines(time: number) {
    if (!this.leftLine || !this.rightLine) return;
    const t = time * 0.001;
    // 振幅をマージン(隙間幅-ボール直径)に連動。両ラインが同時に内側へ振れても
    // 必ず SAFE_MARGIN だけは通せるよう片側振幅を (margin - SAFE)/2 で頭打ちにする。
    // → 余裕のある序盤は最大振幅まで脈動、ギリギリの終盤は自動でほぼ静止（公平性担保）。
    const margin = this.gapWidth - this.ballDiameter;
    const maxOsc = Math.max(0, (margin - GAME.LINE_OSC_SAFE_MARGIN_PX) / 2);
    const amp = Math.min(GAME.LINE_OSCILLATION_AMPLITUDE_PX, maxOsc);
    const leftOsc = Math.sin(t * GAME.LINE_OSC_FREQ_LEFT) * amp;
    const rightOsc = Math.sin(t * GAME.LINE_OSC_FREQ_RIGHT + GAME.LINE_OSC_PHASE_RIGHT) * amp;

    const baseLeft = this.gapCenterX - this.gapWidth / 2;
    const baseRight = GAME.WIDTH - (this.gapCenterX + this.gapWidth / 2);
    const newLeft = Math.max(1, baseLeft + leftOsc);
    const newRight = Math.max(1, baseRight + rightOsc);

    this.leftLine.setSize(newLeft, GAME.LINE_HEIGHT);
    this.leftLine.x = newLeft / 2;
    this.rightLine.setSize(newRight, GAME.LINE_HEIGHT);
    this.rightLine.x = GAME.WIDTH - newRight / 2;

    // 端マーカーをラインの内側端に追従させる（yは登場アニメ中のライン位置に合わせる）
    this.leftMarker?.setPosition(newLeft, this.leftLine.y);
    this.rightMarker?.setPosition(GAME.WIDTH - newRight, this.rightLine.y);

    // グロースプライトもライン/マーカーに追従
    this.syncLineGlows();

    (this.leftLine.body as Phaser.Physics.Arcade.StaticBody | null)?.updateFromGameObject();
    (this.rightLine.body as Phaser.Physics.Arcade.StaticBody | null)?.updateFromGameObject();
  }

  private randomizeGapCenter() {
    const gapHalf = this.gapWidth / 2;
    const min = Math.ceil(gapHalf + GAME.LINE_SEGMENT_MIN_WIDTH);
    const max = Math.floor(GAME.WIDTH - gapHalf - GAME.LINE_SEGMENT_MIN_WIDTH);
    const prev = this.gapCenterX;
    // 連続ステージで必ず一定距離ずらす（毎回横移動させて操作の幅を出す）。
    // 数回引き直して満たせなければ最後の候補を採用（範囲が狭い時のフォールバック）。
    let next = prev;
    for (let i = 0; i < 8; i++) {
      next = Phaser.Math.Between(min, max);
      if (Math.abs(next - prev) >= GAME.GAP_CENTER_MIN_SHIFT_PX) break;
    }
    this.gapCenterX = next;
  }

  // 基準幅(gapBase)に毎ステージのゆらぎを乗せた実効幅を返す。
  // floor(ボール直径+下限)と GAP_INITIAL でクランプし、通過不能/初期より楽 を防ぐ。
  // ゆらぎは累積しない（次ステージは gapBase から計算）ので難易度カーブは保たれる。
  private computeEffectiveGap(): number {
    const floor = this.ballDiameter + GAME.GAP_MIN_MARGIN;
    // 息継ぎステージ: 緩和なので±ゆらぎは乗せず、確実に「広い」を保証する
    const isBreather =
      GAME.BREATHER_EVERY_N > 0 &&
      this.stageCount > 0 &&
      this.stageCount % GAME.BREATHER_EVERY_N === 0;
    if (isBreather) {
      return Phaser.Math.Clamp(this.gapBase + GAME.BREATHER_GAP_BONUS_PX, floor, GAME.GAP_INITIAL);
    }
    const jitter = Phaser.Math.Between(-GAME.GAP_JITTER_PX, GAME.GAP_JITTER_PX);
    return Phaser.Math.Clamp(this.gapBase + jitter, floor, GAME.GAP_INITIAL);
  }

  private onBounce() {
    if (this.isGameOver || this.isScrolling) return;

    this.bounceCount += 1;
    this.perfectStreak = 0;
    this.ballDiameter += GAME.BALL_GROWTH_PER_BOUNCE;
    const radius = this.ballDiameter / 2;
    this.ball.setRadius(radius);
    const body = this.ball.body as Phaser.Physics.Arcade.Body;
    body.setCircle(radius);

    this.squashBall();
    this.emitBounceBurst(this.ball.x, this.ball.y + this.ballDiameter / 2);
    this.updateBallColor();
    this.updateBgColor();
    this.checkWarning();
    playBounce(this.ballDiameter, this.ballPan());

    const sizeRatio = this.ballDiameter / GAME.BALL_INITIAL_DIAMETER;
    this.cameras.main.shake(
      GAME.SHAKE_BASE_DURATION_MS,
      GAME.SHAKE_BASE_INTENSITY * sizeRatio,
    );
    vibrate(Math.min(40, 10 + sizeRatio * 4));

    if (this.ballDiameter > this.gapWidth) {
      this.triggerGameOver();
    }
  }

  private onWallBounce(body: Phaser.Physics.Arcade.Body) {
    if (this.isGameOver || this.isScrolling) return;
    if (body.gameObject !== this.ball) return;
    if (body.blocked.left || body.blocked.right) {
      playWall(this.ballPan());
    }
  }

  // ボールのx位置 → ステレオパン (-1〜+1)
  private ballPan(): number {
    const t = (this.ball.x / GAME.WIDTH) * 2 - 1; // -1..+1
    return Math.max(-1, Math.min(1, t)) * GAME.AUDIO_PAN_STRENGTH;
  }

  // 成功の瞬間に一瞬スローモーション（time scale を下げて実時間で戻す）
  private triggerTimeDilation() {
    const scale = GAME.TIME_DILATION_SCALE;
    this.time.timeScale = scale;
    this.tweens.timeScale = scale;
    if (this.physics.world) this.physics.world.timeScale = 1 / scale; // arcadeは逆数で遅くなる

    // 復帰は実時間で行う（スロー自体に引きずられないよう window.setTimeout を使用）
    window.setTimeout(() => {
      if (!this.scene.isActive()) return;
      this.time.timeScale = 1;
      this.tweens.timeScale = 1;
      if (this.physics.world) this.physics.world.timeScale = 1;
    }, GAME.TIME_DILATION_HOLD_MS + GAME.TIME_DILATION_RECOVER_MS);
  }

  private squashBall() {
    this.tweens.killTweensOf(this.ball);
    // スクワッシュは水平ライン基準の変形なので、ストレッチの回転を戻してから行う
    this.ball.setRotation(0);
    this.ball.setScale(GAME.SQUASH_SCALE_X, GAME.SQUASH_SCALE_Y);
    this.tweens.chain({
      targets: this.ball,
      tweens: [
        {
          scaleX: GAME.EXPAND_SCALE,
          scaleY: GAME.EXPAND_SCALE,
          duration: GAME.SQUASH_DURATION_MS,
          ease: 'Quad.easeOut',
        },
        {
          scaleX: 1,
          scaleY: 1,
          duration: GAME.SETTLE_DURATION_MS,
          ease: 'Quad.easeInOut',
        },
      ],
    });
  }

  private setupInput() {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isGameOver || this.isScrolling) return;
      this.pointerLastX = pointer.worldX;
    });
    this.input.on('pointerup', () => {
      this.pointerLastX = null;
    });
    this.input.on('pointerupoutside', () => {
      this.pointerLastX = null;
    });
  }

  update(_time: number, delta: number) {
    // ニアミスのピボット固定ズームは凍結中も毎フレーム駆動する（カメラだけ動かす）
    if (this.nmActive) this.updateNearMissZoom(delta);

    // ニアミスのストップモーション中は世界の演出を停止（カメラ以外は止まって見える）
    if (this.frozen) {
      muteFallSound();
      return;
    }

    const body = this.ball.body as Phaser.Physics.Arcade.Body | null;
    if (body && body.enable && !this.isGameOver) {
      updateFallSound(
        body.velocity.y,
        GAME.FALL_SOUND_MAX_VELOCITY,
        GAME.FALL_SOUND_MAX_GAIN,
        this.perfectStreak * GAME.FALL_STREAK_PITCH_CENTS,
      );
    } else {
      muteFallSound();
    }

    // パララックスは演出なので常に更新（スクロール中・ゲームオーバー後も動かす）
    this.updateParallax(delta);

    // ハイライト・グローはスクロール復帰tween中もボールに追従させる
    this.syncBallHighlight();
    this.syncBallGlow();
    // 傾きインジケーターは常時更新（スクロール中も現在の傾きを反映）
    this.updateTiltIndicator();

    // グロー強度を sin で揺らがせて「呼吸する発光」にする（強度→alpha にマップ）
    if (this.ballGlow) {
      const pulse = Math.sin(_time * 0.001 * GAME.GLOW_PULSE_FREQ) * GAME.GLOW_PULSE_AMP;
      this.ballGlow.setAlpha(this.glowAlpha(this.ballGlowBase + pulse));
    }
    // ラインはより遅く・小さく呼吸（基準より控えめでゼロにはならない）
    if (this.lineGlows.length) {
      const linePulse = Math.sin(_time * 0.001 * GAME.GLOW_LINE_PULSE_FREQ) * GAME.GLOW_LINE_PULSE_AMP;
      const a = this.glowAlpha(GAME.GLOW_LINE + linePulse);
      for (const g of this.lineGlows) {
        g.setAlpha(a);
      }
    }

    if (this.isGameOver || this.isScrolling || !body) return;

    this.oscillateLines(_time);

    const pointer = this.input.activePointer;

    if (pointer.isDown && this.pointerLastX !== null) {
      const dx = pointer.worldX - this.pointerLastX;
      if (Math.abs(dx) > GAME.SWIPE_DEAD_ZONE_PX) {
        body.velocity.x += dx * GAME.SWIPE_IMPULSE_FACTOR;
      }
      this.pointerLastX = pointer.worldX;
    } else if (!pointer.isDown) {
      this.pointerLastX = null;
    }

    if (tilt.enabled && this.gammaCalibrated) {
      const tiltX = tilt.value - this.gammaRest;
      if (Math.abs(tiltX) > GAME.TILT_DEAD_ZONE_DEG) {
        body.velocity.x += tiltX * GAME.TILT_FACTOR * (delta / 1000);
      }
    }

    this.applyVelocityStretch(body);

    const q = getQuality();
    if (q.trailEnabled) {
      this.trailTimer += delta;
      if (this.trailTimer >= q.trailIntervalMs) {
        this.trailTimer = 0;
        const speed = Math.hypot(body.velocity.x, body.velocity.y);
        if (speed > GAME.TRAIL_MIN_SPEED) {
          this.spawnTrailDot();
        }
      }
    }

    // 常時パーティクル: 移動中はきらめく粒を撒く（コンボ中は数が増え金色が混ざる）
    this.ambientTimer += delta;
    if (this.ambientTimer >= GAME.AMBIENT_INTERVAL_MS) {
      this.ambientTimer = 0;
      const speed = Math.hypot(body.velocity.x, body.velocity.y);
      if (speed > GAME.AMBIENT_MIN_SPEED) {
        this.emitAmbient(body);
      }
    }

    if (!this.hasPassedGap && this.ball.y > GAME.LINE_Y + GAME.LINE_HEIGHT) {
      // 実際の（伸縮後の）ライン位置で判定
      const leftInnerX = this.leftLine.x + this.leftLine.width / 2;
      const rightInnerX = this.rightLine.x - this.rightLine.width / 2;
      if (this.ball.x > leftInnerX && this.ball.x < rightInnerX) {
        // ボール端から左右ライン端までの余白（ニアミス判定用）
        const radius = this.ballDiameter / 2;
        const leftMargin = (this.ball.x - leftInnerX) - radius;
        const rightMargin = (rightInnerX - this.ball.x) - radius;
        const clearance = Math.min(leftMargin, rightMargin);
        // ギリギリだった側のライン端をフォーカス点に
        const focusEdgeX = leftMargin < rightMargin ? leftInnerX : rightInnerX;
        const focusX = (this.ball.x + focusEdgeX) / 2;
        this.onPassThroughGap(clearance, focusX);
        return;
      }
    }

    if (this.ball.y > GAME.HEIGHT + 200 || this.ball.x < -200 || this.ball.x > GAME.WIDTH + 200) {
      this.triggerGameOver();
    }
  }

  private onPassThroughGap(clearance = Infinity, focusX = GAME.WIDTH / 2) {
    this.hasPassedGap = true;
    this.isScrolling = true;
    this.dismissGuide();

    const isNearMiss = clearance <= GAME.NEAR_MISS_CLEARANCE_PX;
    const isPerfect = this.bounceCount === 0;
    // ボール色の進行度 t (0=初期色、1=完全に終端色) が閾値以上で終端色ボーナス発動
    const isAtEndColor = this.ballColorT() >= GAME.END_COLOR_BONUS_THRESHOLD;

    // 連続パーフェクトの計数を先に更新（コンボボーナスの算出で使う）
    if (isPerfect) {
      this.perfectStreak += 1;
      this.perfectCount += 1;
      this.maxPerfectStreak = Math.max(this.maxPerfectStreak, this.perfectStreak);
    }
    if (isNearMiss) {
      this.nearMissCount += 1;
    }

    let points = isPerfect ? 1 + GAME.NO_BOUNCE_BONUS : 1;
    // コンボボーナス: PERFECT が 2 回以上連続した時、コンボ回数を加算
    // (例: streak=2 → +2、streak=3 → +3 ...)
    if (isPerfect && this.perfectStreak >= 2) {
      points += this.perfectStreak;
    }
    if (isAtEndColor) {
      // 終端色での通過は別途加算。PERFECT 時は更に倍。
      points += isPerfect ? GAME.END_COLOR_BONUS * 2 : GAME.END_COLOR_BONUS;
    }
    if (isNearMiss) {
      // ギリギリ通過（CLOSE）のボーナス
      points += GAME.NEAR_MISS_BONUS;
    }
    const prevScore = this.score;
    this.score += points;
    this.scoreText.setText(this.score.toString());

    // BGM の盛り上がりをスコアに連動
    const newIntensity = intensityFromScore(this.score);
    if (newIntensity !== this.musicIntensity) {
      this.musicIntensity = newIntensity;
      setMusicIntensity(newIntensity);
    }

    // マイルストーン到達チェック（1回の通過で複数跨いだ場合は最高位を採用）
    this.checkMilestones(prevScore, this.score);

    // 自己ベスト超えチェック（初回プレイ=ベスト0のときは Result の NEW BEST に任せる）
    if (!this.bestBeaten && this.prevBest > 0 && this.score > this.prevBest) {
      this.triggerBestBeaten();
    }

    this.stopWarning();
    this.popScore();
    this.flashScreen();
    const particleCount = isPerfect
      ? GAME.PARTICLE_COUNT + GAME.PERFECT_PARTICLE_COUNT
      : GAME.PARTICLE_COUNT;
    this.emitBurst(this.ball.x, GAME.LINE_Y, particleCount);
    this.spawnScorePopup(this.ball.x, GAME.LINE_Y, points, isPerfect, isAtEndColor);
    // ニアミス時は専用のストップモーション演出を使うので通常のスローは省く
    if (!isNearMiss) this.triggerTimeDilation();
    const pan = this.ballPan();
    if (isPerfect) {
      this.spawnPerfectText(this.perfectStreak);
      playPerfectPass(this.perfectStreak * GAME.FALL_STREAK_PITCH_CENTS, pan);
      vibrate([0, 40, 30, 40, 30, 60]);
    } else {
      playPass(pan);
      vibrate([0, 25, 40, 25]);
    }

    const body = this.ball.body as Phaser.Physics.Arcade.Body;
    body.enable = false;
    // ベロシティストレッチの変形をリセット（スクロール中は等速で見せる）
    this.ball.setRotation(0).setScale(1);

    const oldLeft = this.leftLine;
    const oldRight = this.rightLine;
    const oldMarkerL = this.leftMarker;
    const oldMarkerR = this.rightMarker;
    // グロースプライト（lowティアでは未生成→undefined を除外）。ラインと一緒に流して破棄
    const oldGlows = [
      this.leftLineGlow, this.rightLineGlow, this.leftMarkerGlow, this.rightMarkerGlow,
    ].filter(Boolean);

    this.tweens.add({
      targets: [oldLeft, oldRight, oldMarkerL, oldMarkerR, ...oldGlows],
      y: -GAME.LINE_HEIGHT,
      duration: GAME.SCROLL_DURATION,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        oldLeft.destroy();
        oldRight.destroy();
        oldMarkerL.destroy();
        oldMarkerR.destroy();
        oldGlows.forEach((g) => g.destroy());
      },
    });

    // 背景パララックスをラインと同じ動き（時間・イージング）でスクロールアウトさせる。
    // tweens.timeScale 経由でタイムダイレーションのスローにも自動同期する。
    this.scrollProxy.y = GAME.LINE_Y;
    this.scrollPrevY = GAME.LINE_Y;
    this.parallaxScrolling = true;
    this.tweens.add({
      targets: this.scrollProxy,
      y: -GAME.LINE_HEIGHT,
      duration: GAME.SCROLL_DURATION,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        this.parallaxScrolling = false;
      },
    });

    this.tweens.add({
      targets: this.ball,
      y: GAME.BALL_START_Y,
      duration: GAME.SCROLL_DURATION,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.stageCount += 1;
        // 基準幅を単調に縮め（難易度カーブ本体）、実効幅はそこに非累積ジッタ/息継ぎを乗せる
        this.gapBase = Math.max(
          this.ballDiameter + GAME.GAP_MIN_MARGIN,
          this.gapBase - GAME.GAP_REDUCTION,
        );
        this.gapWidth = this.computeEffectiveGap();
        this.updateBgColor();
        this.updateBallColor(); // 穴が縮んで比率が変わったのでボール色も更新

        if (this.ballDiameter > this.gapWidth) {
          body.enable = true;
          this.triggerGameOver();
          return;
        }

        this.randomizeGapCenter();
        this.createLines();

        const enterY = GAME.HEIGHT + GAME.LINE_ENTER_OFFSET_PX;
        this.leftLine.y = enterY;
        this.rightLine.y = enterY;
        this.leftMarker.y = enterY;
        this.rightMarker.y = enterY;
        // 新グローも登場位置へ寄せて一緒に登場させる（lowティアでは undefined 除外）
        const newGlows = [
          this.leftLineGlow, this.rightLineGlow, this.leftMarkerGlow, this.rightMarkerGlow,
        ].filter(Boolean);
        newGlows.forEach((g) => { g.y = enterY; });
        this.tweens.add({
          targets: [this.leftLine, this.rightLine, this.leftMarker, this.rightMarker, ...newGlows],
          y: GAME.LINE_Y,
          duration: GAME.LINE_ENTER_DURATION_MS,
          ease: 'Back.easeOut',
          onComplete: () => {
            body.setVelocity(0, 0);
            body.enable = true;
            this.bounceCount = 0;
            this.checkWarning();
            this.hasPassedGap = false;
            this.isScrolling = false;
          },
        });
      },
    });

    // ニアミス時はここで全体をストップモーション + 強ズーム（スクロールtween生成後に凍結）
    if (isNearMiss) {
      this.triggerNearMiss(focusX, GAME.LINE_Y, pan);
    }
  }

  private popScore() {
    this.tweens.killTweensOf(this.scoreText);
    this.scoreText.setScale(GAME.SCORE_POP_SCALE).setAlpha(0.95);
    this.tweens.add({
      targets: this.scoreText,
      scale: 1,
      alpha: 0.5,
      duration: GAME.SCORE_POP_DURATION_MS * 2,
      ease: 'Quad.easeOut',
    });
  }

  private flashScreen() {
    const flash = this.add.rectangle(
      GAME.WIDTH / 2, GAME.HEIGHT / 2,
      GAME.WIDTH, GAME.HEIGHT,
      0xffffff, GAME.FLASH_ALPHA,
    ).setDepth(1000);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: GAME.FLASH_DURATION_MS,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });
  }

  // 落下中のきらめき。ボールの縁から粒を散らし、進行と逆方向+ランダムに漂わせて消す。
  // PERFECTコンボ1につき粒が+1個（上限あり）、コンボ中は金色の粒が混ざる。
  private emitAmbient(body: Phaser.Physics.Arcade.Body) {
    const extra = Math.min(this.perfectStreak, GAME.AMBIENT_STREAK_MAX);
    const n = Math.max(1, Math.round((1 + extra) * getQuality().particleScale));
    const r = this.ballDiameter / 2;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const px = this.ball.x + Math.cos(ang) * r * 0.8;
      const py = this.ball.y + Math.sin(ang) * r * 0.8;
      const gold = this.perfectStreak > 0 && Math.random() < GAME.AMBIENT_GOLD_RATIO;
      // emitParticleAt は同期実行なので、直前にセットした値を onEmit が粒ごとに読む
      this.ambTint = gold ? 0xffd700 : this.ball.fillColor;
      const driftX = (Math.random() - 0.5) * GAME.AMBIENT_DRIFT_PX - body.velocity.x * 0.04;
      const driftY = (Math.random() - 0.5) * GAME.AMBIENT_DRIFT_PX - body.velocity.y * 0.06;
      this.ambToX = px + driftX;
      this.ambToY = py + driftY;
      this.ambientEmitter.emitParticleAt(px, py);
    }
  }

  private spawnTrailDot() {
    // サイズ・色はエミッタの onEmit がボール状態を参照するので位置指定だけでよい
    this.trailEmitter.emitParticleAt(this.ball.x, this.ball.y);
  }

  private checkWarning() {
    const ratio = this.ballDiameter / this.gapWidth;
    if (ratio >= GAME.WARNING_THRESHOLD) {
      this.startWarning();
    } else {
      this.stopWarning();
    }
  }

  private startWarning() {
    if (this.warningActive) return;
    this.warningActive = true;
    this.warningTween = this.tweens.add({
      targets: [this.leftLine, this.rightLine, this.leftMarker, this.rightMarker],
      alpha: 0.35,
      duration: GAME.WARNING_PULSE_DURATION_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.leftLine.setFillStyle(0xff4830);
    this.rightLine.setFillStyle(0xff4830);
    this.leftMarker?.setFillStyle(0xff4830);
    this.rightMarker?.setFillStyle(0xff4830);

    // 画面周辺の赤ビネットを脈動させ、BGMをこもらせて緊張感を立体化する
    if (this.warnVignette) {
      this.warnVignetteTween = this.tweens.add({
        targets: this.warnVignette,
        alpha: GAME.WARNING_VIGNETTE_ALPHA,
        duration: GAME.WARNING_PULSE_DURATION_MS,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    setMusicMuffled(true);
  }

  private stopWarning() {
    if (!this.warningActive) return;
    this.warningActive = false;
    if (this.warningTween) {
      this.warningTween.stop();
      this.warningTween = null;
    }
    this.leftLine?.setAlpha(1);
    this.rightLine?.setAlpha(1);
    this.leftLine?.setFillStyle(GAME.LINE_COLOR);
    this.rightLine?.setFillStyle(GAME.LINE_COLOR);
    this.leftMarker?.setAlpha(1);
    this.rightMarker?.setAlpha(1);
    this.leftMarker?.setFillStyle(GAME.GAP_MARKER_COLOR);
    this.rightMarker?.setFillStyle(GAME.GAP_MARKER_COLOR);
    if (this.warnVignetteTween) {
      this.warnVignetteTween.stop();
      this.warnVignetteTween = null;
    }
    this.warnVignette?.setAlpha(0);
    setMusicMuffled(false);
  }

  // ボール色の進行度 t (0=開始色、1=終端色)。「ボール直径 / 基準穴幅」の比率で決まる。
  // 実効幅(gapWidth)ではなく決定論的な gapBase を使うことで、息継ぎ/ジッタの一時的な
  // 幅変化で色が往復せず、難易度カーブに沿って滑らかに進行する。
  private ballColorT(): number {
    const ratio = this.ballDiameter / this.gapBase;
    const t = (ratio - GAME.BALL_COLOR_RATIO_START) / (GAME.BALL_COLOR_RATIO_END - GAME.BALL_COLOR_RATIO_START);
    return Math.max(0, Math.min(1, t));
  }

  private updateBallColor() {
    const t = this.ballColorT();
    const c = lerpColor(GAME.BALL_COLOR_START, GAME.BALL_COLOR_END, t);
    this.ball.setFillStyle(c);
    // 終端色に近づくほどグロー基準を強くし、色はボール色を明るくした同系色にする
    // （実際の強度は update() で sin 揺らぎを乗せる）
    this.ballGlowBase = GAME.GLOW_BALL_BASE + (GAME.GLOW_BALL_MAX - GAME.GLOW_BALL_BASE) * t;
    if (this.ballGlow) {
      this.ballGlow.setTint(brighten(c, GAME.GLOW_BALL_BRIGHTEN));
    }
  }

  private updateBgColor() {
    // ボール色と同様、実効幅ではなく基準幅(gapBase)基準。息継ぎ/ジッタで背景が往復しない。
    const ratio = this.gapBase / this.ballDiameter;
    const targetT = this.bgProgressFromRatio(ratio);
    const proxy = { t: this.bgProgress };
    this.tweens.add({
      targets: proxy,
      t: targetT,
      duration: 600,
      ease: 'Quad.easeOut',
      onUpdate: () => {
        this.bgProgress = proxy.t;
        const c = lerpColor(GAME.BG_COLOR_START, GAME.BG_COLOR_END, proxy.t);
        this.cameras.main.setBackgroundColor(c);
      },
    });
  }

  // 隙間幅/ボール直径 の比率 → 補間係数 t (0=START 色, 1=END 色)
  // 区分線形補間で 4つの breakpoint をつなぐ
  private bgProgressFromRatio(ratio: number): number {
    const r0 = GAME.BG_GAP_RATIO_START;
    const r1 = GAME.BG_GAP_RATIO_25;
    const r2 = GAME.BG_GAP_RATIO_50;
    const r3 = GAME.BG_GAP_RATIO_END;
    if (ratio >= r0) return 0;
    if (ratio >= r1) return ((r0 - ratio) / (r0 - r1)) * 0.25;
    if (ratio >= r2) return 0.25 + ((r1 - ratio) / (r1 - r2)) * 0.25;
    if (ratio >= r3) return 0.5 + ((r2 - ratio) / (r2 - r3)) * 0.5;
    return 1;
  }

  private spawnScorePopup(x: number, y: number, points: number, special: boolean, isAtEndColor = false) {
    // 終端色ボーナスは色とサイズで一段格上にする
    let fontSize: string;
    let color: string;
    if (isAtEndColor && special) {
      fontSize = '108px';
      color = '#ff70a0'; // ピンク寄りの赤紫: 究極ボーナス
    } else if (isAtEndColor) {
      fontSize = '88px';
      color = '#ff5040'; // 終端色っぽい赤
    } else if (special) {
      fontSize = '88px';
      color = '#ffd700'; // PERFECT 金
    } else {
      fontSize = '64px';
      color = '#ffeb70'; // 通常 黄
    }
    const text = this.add.text(x, y, `+${points}`, {
      fontFamily: FONT_FAMILY,
      fontSize,
      color,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(950);
    this.tweens.add({
      targets: text,
      y: y - GAME.SCORE_POPUP_RISE_PX,
      alpha: 0,
      duration: GAME.SCORE_POPUP_DURATION_MS,
      ease: 'Quad.easeOut',
      onComplete: () => text.destroy(),
    });
  }

  // ニアミス: ボール位置を画面上で固定したまま、その点を中心にズームイン→保持→ズームアウト
  private triggerNearMiss(focusX: number, focusY: number, pan: number) {
    playNearMiss(pan);
    vibrate([0, 25, 30, 60]);

    // CLOSE! テキスト（凍結中も見えるよう即座に表示状態で生成）。ボーナス点も併記
    const label = GAME.NEAR_MISS_BONUS > 0 ? `CLOSE!  +${GAME.NEAR_MISS_BONUS}` : 'CLOSE!';
    this.nmText = this.add.text(focusX, focusY - 70, label, {
      fontFamily: FONT_FAMILY,
      fontSize: '40px',
      color: '#70d6ff',
      fontStyle: 'bold',
      padding: { top: 6, bottom: 4 },
    }).setOrigin(0.5).setDepth(958).setAlpha(1).setScale(1);

    // ズームの中心（ピボット）= ボールの現在位置。ここが画面上で動かない
    this.nmPivotX = this.ball.x;
    this.nmPivotY = this.ball.y;
    this.nmElapsed = 0;
    this.nmActive = true;

    // 世界を停止（カメラズームだけ update で動かす）
    this.frozen = true;
    this.physics.world.pause();
    this.tweens.pauseAll();
    // 飛散中のパーティクルもストップモーションに合わせて凍結
    this.burstEmitter.pause();
    this.bounceEmitter.pause();
    this.trailEmitter.pause();
    this.ambientEmitter.pause();
  }

  // 毎フレーム呼ばれ、ピボットを画面上で固定したままズーム倍率を時間で変化させる
  private updateNearMissZoom(delta: number) {
    this.nmElapsed += delta;
    const IN = GAME.NEAR_MISS_ZOOM_IN_MS;
    const HOLD = GAME.NEAR_MISS_HOLD_MS;
    const OUT = GAME.NEAR_MISS_ZOOM_OUT_MS;
    const Z = GAME.NEAR_MISS_ZOOM;
    const t = this.nmElapsed;

    let z: number;
    if (t < IN) {
      const p = t / IN;
      z = 1 + (Z - 1) * (1 - (1 - p) * (1 - p)); // easeOut
    } else if (t < IN + HOLD) {
      z = Z;
    } else if (t < IN + HOLD + OUT) {
      const p = (t - IN - HOLD) / OUT;
      z = Z + (1 - Z) * (p * p); // easeIn で 1 へ
    } else {
      this.applyPivotZoom(1);
      this.endNearMiss();
      return;
    }
    this.applyPivotZoom(z);
  }

  // ピボット (nmPivotX/Y) の画面位置を保ったままズーム倍率 z を適用
  // 導出: screen = (world - scroll - mid) * z + mid を pivot で固定すると
  //       scroll = (pivot - mid) * (1 - 1/z)
  private applyPivotZoom(z: number) {
    const cam = this.cameras.main;
    cam.setZoom(z);
    const sx = (this.nmPivotX - GAME.WIDTH / 2) * (1 - 1 / z);
    const sy = (this.nmPivotY - GAME.HEIGHT / 2) * (1 - 1 / z);
    cam.setScroll(sx, sy);
  }

  private endNearMiss() {
    this.nmActive = false;
    this.frozen = false;
    const cam = this.cameras.main;
    cam.setZoom(1);
    cam.setScroll(0, 0);
    this.physics.world.resume();
    this.tweens.resumeAll();
    this.burstEmitter.resume();
    this.bounceEmitter.resume();
    this.trailEmitter.resume();
    this.ambientEmitter.resume();
    if (this.nmText) {
      const text = this.nmText;
      this.nmText = null;
      this.tweens.add({
        targets: text,
        alpha: 0,
        scale: 1.3,
        duration: 220,
        ease: 'Quad.easeIn',
        onComplete: () => text.destroy(),
      });
    }
  }

  // 自己ベスト超え演出（1プレイ1回。以後スコアHUDが金色のままになる）
  private triggerBestBeaten() {
    this.bestBeaten = true;
    playBestBeaten();
    vibrate([0, 30, 30, 60]);
    this.scoreText.setColor('#ffd700');

    const text = this.add.text(GAME.WIDTH / 2, 195, 'NEW BEST!', {
      fontFamily: FONT_FAMILY,
      fontSize: '44px',
      color: '#ffd700',
      fontStyle: 'bold',
      padding: { top: 6, bottom: 4 },
    }).setOrigin(0.5).setDepth(955).setAlpha(0).setScale(0.5);
    this.tweens.chain({
      targets: text,
      tweens: [
        { alpha: 1, scale: 1.1, duration: 220, ease: 'Back.easeOut' },
        { scale: 1.0, duration: 120, ease: 'Quad.easeOut' },
        { alpha: 0, scale: 1.15, duration: 500, delay: 900, ease: 'Quad.easeIn' },
      ],
      onComplete: () => text.destroy(),
    });
  }

  // マイルストーン到達演出（prev→now でしきい値を跨いだら発動）
  private checkMilestones(prevScore: number, nowScore: number) {
    let reached: number | null = null;
    while (
      this.nextMilestoneIdx < GAME.MILESTONES.length &&
      nowScore >= GAME.MILESTONES[this.nextMilestoneIdx]
    ) {
      reached = GAME.MILESTONES[this.nextMilestoneIdx];
      this.nextMilestoneIdx += 1;
    }
    if (reached !== null && prevScore < reached) {
      this.triggerMilestone(reached);
    }
  }

  private triggerMilestone(value: number) {
    playMilestone();
    vibrate([0, 50, 40, 50, 40, 80]);
    // 画面全体の彩度フラッシュ（淡い金色）
    const flash = this.add.rectangle(
      GAME.WIDTH / 2, GAME.HEIGHT / 2, GAME.WIDTH, GAME.HEIGHT, 0xffe070, 0.25,
    ).setDepth(990);
    this.tweens.add({
      targets: flash, alpha: 0, duration: 400, ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });
    // 上部（スコアHUDの上）に配置。数字を上、その下に "MILESTONE"
    const valueY = 250;
    const labelY = 360;
    const text = this.add.text(GAME.WIDTH / 2, valueY, `${value}`, {
      fontFamily: FONT_FAMILY,
      fontSize: '150px',
      color: '#ffe070',
      fontStyle: '800',
      padding: { top: 10, bottom: 8 },
    }).setOrigin(0.5).setDepth(992).setAlpha(0).setScale(0.3);
    const sub = this.add.text(GAME.WIDTH / 2, labelY, 'MILESTONE', {
      fontFamily: FONT_FAMILY,
      fontSize: '46px',
      color: '#ffffff',
      fontStyle: 'bold',
      padding: { top: 6, bottom: 4 },
    }).setOrigin(0.5).setDepth(992).setAlpha(0);
    this.tweens.add({ targets: sub, alpha: 1, duration: 200, yoyo: true, hold: GAME.MILESTONE_TEXT_MS - 600, onComplete: () => sub.destroy() });
    this.tweens.chain({
      targets: text,
      tweens: [
        { alpha: 1, scale: 1.15, duration: 250, ease: 'Back.easeOut' },
        { scale: 1.0, duration: 150, ease: 'Quad.easeOut' },
        { alpha: 0, scale: 1.3, duration: GAME.MILESTONE_TEXT_MS - 400, ease: 'Quad.easeIn' },
      ],
      onComplete: () => text.destroy(),
    });
  }

  private spawnPerfectText(streak: number) {
    const label = streak > 1 ? `PERFECT!×${streak}` : 'PERFECT!';
    const text = this.add.text(GAME.WIDTH / 2, GAME.HEIGHT / 2 - 80, label, {
      fontFamily: FONT_FAMILY,
      fontSize: '88px',
      color: '#ffd700',
      fontStyle: '800',
      padding: { top: 8, bottom: 6 },
    }).setOrigin(0.5).setDepth(960).setAlpha(0).setScale(0.4);
    this.tweens.chain({
      targets: text,
      tweens: [
        { alpha: 1, scale: 1.2, duration: 180, ease: 'Back.easeOut' },
        { scale: 1.0, duration: 120, ease: 'Quad.easeOut' },
        { alpha: 0, scale: 1.4, duration: GAME.PERFECT_TEXT_DURATION_MS - 300, ease: 'Quad.easeIn' },
      ],
      onComplete: () => text.destroy(),
    });
  }

  // 円テクスチャを1枚焼き、3つのエミッタを生成して使い回す。
  // GameObject(円)の都度生成/破棄と個別Tweenをやめ、バッチ描画＆内部プールに載せる。
  private createParticles() {
    const R = GameScene.PARTICLE_TEX_RADIUS;
    const tex = GameScene.PARTICLE_TEXTURE;
    if (!this.textures.exists(tex)) {
      const g = this.make.graphics({ x: 0, y: 0 });
      g.fillStyle(0xffffff, 1);
      g.fillCircle(R, R, R);
      g.generateTexture(tex, R * 2, R * 2);
      g.destroy();
    }
    this.bakeGlowTexture();

    // 通過時の放射バースト（全方位）。色は固定のボールカラー。
    this.burstEmitter = this.add.particles(0, 0, tex, {
      lifespan: GAME.PARTICLE_DURATION_MS,
      speed: { min: GAME.PARTICLE_SPEED_MIN, max: GAME.PARTICLE_SPEED_MAX },
      angle: { min: 0, max: 360 },
      scale: { start: 4.5 / R, end: 0.9 / R }, // 半径3〜6px相当→縮小
      alpha: { start: 1, end: 0 },
      tint: GAME.BALL_COLOR,
      emitting: false,
    }).setDepth(900);

    // バウンス時の上向きバースト。色はその時のボール色に追従。
    this.bounceEmitter = this.add.particles(0, 0, tex, {
      lifespan: GAME.BOUNCE_PARTICLE_DURATION_MS,
      speed: { min: GAME.BOUNCE_PARTICLE_SPEED_MIN, max: GAME.BOUNCE_PARTICLE_SPEED_MAX },
      angle: { min: -150, max: -30 }, // 真上(-90°)を中心に約±60°の扇
      scale: { start: 3 / R, end: 0.9 / R },
      alpha: { start: 0.9, end: 0 },
      tint: { onEmit: () => this.ball.fillColor },
      emitting: false,
    }).setDepth(850);

    // ボールの残像トレイル。サイズと色はボールに追従（速度0でその場フェード）。
    this.trailEmitter = this.add.particles(0, 0, tex, {
      lifespan: GAME.TRAIL_DURATION_MS,
      speed: 0,
      scale: { onEmit: () => (this.ballDiameter / 2) / R },
      alpha: { start: GAME.TRAIL_ALPHA, end: 0 },
      tint: { onEmit: () => this.ball.fillColor },
      emitting: false,
    }).setDepth(-1);

    // 落下中の常時きらめき。粒ごとに色(ambTint)と移動先(ambToX/Y)を onEmit で受け取り、
    // moveTo で寿命をかけて漂わせる（元の per-粒 tween を再現）。
    this.ambientEmitter = this.add.particles(0, 0, tex, {
      lifespan: GAME.AMBIENT_DURATION_MS,
      scale: { start: 3 / R, end: 0.6 / R }, // 半径2〜4px相当→縮小
      alpha: { start: 0.85, end: 0 },
      tint: { onEmit: () => this.ambTint },
      moveToX: { onEmit: () => this.ambToX },
      moveToY: { onEmit: () => this.ambToY },
      emitting: false,
    }).setDepth(-1);

    // 死亡時のボール破裂。放射状＋重力で少し落下感。色はボール色／25%白。
    this.deathEmitter = this.add.particles(0, 0, tex, {
      lifespan: GAME.DEATH_PARTICLE_DURATION_MS,
      speed: { min: GAME.DEATH_PARTICLE_SPEED_MIN * 0.85, max: GAME.DEATH_PARTICLE_SPEED_MAX * 0.85 },
      angle: { min: 0, max: 360 },
      gravityY: 250, // 元の「+60px 下方向」を重力で近似
      scale: { start: 5.5 / R, end: 1.1 / R }, // 半径3〜8px相当→縮小
      alpha: { start: 1, end: 0 },
      tint: { onEmit: () => (Math.random() < 0.25 ? 0xffffff : this.deathColor) },
      emitting: false,
    }).setDepth(900);
  }

  private emitBounceBurst(x: number, y: number) {
    const n = Math.max(1, Math.round(GAME.BOUNCE_PARTICLE_COUNT * getQuality().particleScale));
    this.bounceEmitter.explode(n, x, y);
  }

  private emitBurst(x: number, y: number, count: number) {
    const n = Math.max(1, Math.round(count * getQuality().particleScale));
    this.burstEmitter.explode(n, x, y);
  }

  private triggerGameOver() {
    if (this.isGameOver) return;
    this.isGameOver = true;

    // ゲームオーバーで操作は終了するのでスリープ抑止を解除（プレイ中のみ抑止）
    disableWakeLock();

    // タイムダイレーションが残っていたら通常速度へ戻す
    this.time.timeScale = 1;
    this.tweens.timeScale = 1;
    if (this.physics.world) this.physics.world.timeScale = 1;
    this.frozen = false;
    this.nmActive = false;
    if (this.nmText) { this.nmText.destroy(); this.nmText = null; }
    this.physics.world.resume(); // 万一フリーズ中なら解除
    this.burstEmitter?.resume();
    this.bounceEmitter?.resume();
    this.trailEmitter?.resume();
    this.ambientEmitter?.resume();
    this.cameras.main.setZoom(1); // ニアミスズームが残っていたら戻す
    this.cameras.main.setScroll(0, 0);

    this.stopWarning();
    this.dismissGuide();
    muteFallSound();
    tapeStopMusic(); // BGMはピッチが落ちながら止まる（テープストップ）
    const body = this.ball.body as Phaser.Physics.Arcade.Body | null;
    if (body) {
      body.setVelocity(0, 0);
      body.enable = false;
    }

    try {
      const prevBest = Number(localStorage.getItem(STORAGE_KEYS.HIGH_SCORE) ?? 0);
      if (this.score > prevBest) {
        localStorage.setItem(STORAGE_KEYS.HIGH_SCORE, this.score.toString());
      }
      const playCount = Number(localStorage.getItem(STORAGE_KEYS.PLAY_COUNT) ?? 0) + 1;
      localStorage.setItem(STORAGE_KEYS.PLAY_COUNT, playCount.toString());
    } catch {
      // localStorage may be unavailable (private mode, etc.) — skip persistence
    }

    // --- 死の演出 ---
    // 1) ボールが破裂して飛び散る
    this.explodeBall();

    // 2) 背景の彩度が抜ける（暗幕をかぶせて世界から色味を奪う）
    const desat = this.add.rectangle(
      GAME.WIDTH / 2, GAME.HEIGHT / 2, GAME.WIDTH, GAME.HEIGHT,
      0x0a0a12, GAME.DEATH_DESAT_ALPHA,
    ).setDepth(940).setAlpha(0);
    this.tweens.add({
      targets: desat, alpha: 1, duration: 450, ease: 'Quad.easeOut',
    });

    // 3) なぜ死んだかの比較表示: 隙間の位置にボール直径のゴーストを重ねて
    //    「ボールが隙間より大きい」ことを見せる（サイズ起因の死のみ）
    if (this.ballDiameter > this.gapWidth) {
      const ghost = this.add.circle(
        this.gapCenterX, GAME.LINE_Y, this.ballDiameter / 2, 0xff4830, 0.28,
      ).setStrokeStyle(3, 0xff7060, 0.9).setDepth(945).setAlpha(0);
      // ラベル全幅（約360px）が画面内に収まるよう中央へ寄せる
      const labelX = Phaser.Math.Clamp(this.gapCenterX, 200, GAME.WIDTH - 200);
      const label = this.add.text(
        labelX, GAME.LINE_Y - this.ballDiameter / 2 - 64,
        `BALL ${Math.round(this.ballDiameter)}  >  GAP ${Math.round(this.gapWidth)}`,
        {
          fontFamily: FONT_FAMILY,
          fontSize: '36px',
          color: '#ff9080',
          fontStyle: 'bold',
          padding: { top: 6, bottom: 4 },
        },
      ).setOrigin(0.5).setDepth(946).setAlpha(0);
      this.tweens.add({
        targets: [ghost, label], alpha: 1, duration: 350, delay: 250, ease: 'Quad.easeOut',
      });
    }

    // 4) 一瞬のスローモーション（破裂・暗転の tween をゆっくり見せ、実時間で復帰）
    this.tweens.timeScale = GAME.DEATH_SLOWMO_SCALE;
    window.setTimeout(() => {
      if (this.scene.isActive()) this.tweens.timeScale = 1;
    }, GAME.DEATH_SLOWMO_MS);

    this.cameras.main.shake(GAME.SHAKE_GAMEOVER_DURATION_MS, GAME.SHAKE_GAMEOVER_INTENSITY);
    playGameOver();
    vibrate([0, 60, 30, 120]);

    this.time.delayedCall(GAME.DEATH_RESULT_DELAY_MS, () => {
      this.scene.start('Result', {
        score: this.score,
        perfects: this.perfectCount,
        maxStreak: this.maxPerfectStreak,
        closes: this.nearMissCount,
      });
    });
  }

  // ボールの破裂: 本体を隠し、ボール色の破片を放射状に飛ばす（少し落下感を付ける）
  private explodeBall() {
    const x = this.ball.x;
    const y = this.ball.y;
    this.deathColor = this.ball.fillColor;
    this.tweens.killTweensOf(this.ball);
    this.ball.setVisible(false);
    this.ballHighlight.setVisible(false);

    const n = Math.max(8, Math.round(GAME.DEATH_PARTICLE_COUNT * getQuality().particleScale));
    this.deathEmitter.explode(n, x, y);
  }
}
