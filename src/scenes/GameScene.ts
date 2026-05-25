import Phaser from 'phaser';
import { GAME, STORAGE_KEYS } from '../config/balance';
import { tilt } from '../input/tilt';
import { playBounce, playWall, playPass, playGameOver, playPerfectPass, updateFallSound, muteFallSound } from '../audio/sfx';
import { vibrate } from '../input/haptics';
import { lerpColor } from '../util/color';

export class GameScene extends Phaser.Scene {
  private ball!: Phaser.GameObjects.Arc;
  private leftLine!: Phaser.GameObjects.Rectangle;
  private rightLine!: Phaser.GameObjects.Rectangle;

  private gapWidth = GAME.GAP_INITIAL;
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
  private warningActive = false;
  private warningTween: Phaser.Tweens.Tween | null = null;
  private bounceCount = 0;
  private perfectStreak = 0;

  constructor() {
    super('Game');
  }

  create() {
    this.gapWidth = GAME.GAP_INITIAL;
    this.gapCenterX = GAME.WIDTH / 2;
    this.ballDiameter = GAME.BALL_INITIAL_DIAMETER;
    this.score = 0;
    this.hasPassedGap = false;
    this.isGameOver = false;
    this.isScrolling = false;
    this.pointerLastX = null;
    this.bgProgress = 0;
    this.trailTimer = 0;
    this.warningActive = false;
    this.bounceCount = 0;
    this.perfectStreak = 0;
    this.cameras.main.setBackgroundColor(GAME.BG_COLOR_START);

    this.scoreText = this.add.text(GAME.WIDTH / 2, 100, '0', {
      fontSize: '120px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0.5);

    this.physics.world.setBoundsCollision(true, true, false, false);
    this.createBall();
    this.randomizeGapCenter();
    this.createLines();
    this.setupInput();
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

    this.physics.add.collider(this.ball, this.leftLine, () => this.onBounce());
    this.physics.add.collider(this.ball, this.rightLine, () => this.onBounce());
  }

  private oscillateLines(time: number) {
    if (!this.leftLine || !this.rightLine) return;
    const t = time * 0.001;
    const amp = GAME.LINE_OSCILLATION_AMPLITUDE_PX;
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

    (this.leftLine.body as Phaser.Physics.Arcade.StaticBody | null)?.updateFromGameObject();
    (this.rightLine.body as Phaser.Physics.Arcade.StaticBody | null)?.updateFromGameObject();
  }

  private randomizeGapCenter() {
    const gapHalf = this.gapWidth / 2;
    const min = gapHalf + GAME.LINE_SEGMENT_MIN_WIDTH;
    const max = GAME.WIDTH - gapHalf - GAME.LINE_SEGMENT_MIN_WIDTH;
    this.gapCenterX = Phaser.Math.Between(Math.ceil(min), Math.floor(max));
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
    playBounce(this.ballDiameter);

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
      playWall();
    }
  }

  private squashBall() {
    this.tweens.killTweensOf(this.ball);
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

    if (tilt.enabled && Math.abs(tilt.value) > GAME.TILT_DEAD_ZONE_DEG) {
      body.velocity.x += tilt.value * GAME.TILT_FACTOR * (delta / 1000);
    }

    this.trailTimer += delta;
    if (this.trailTimer >= GAME.TRAIL_INTERVAL_MS) {
      this.trailTimer = 0;
      const speed = Math.hypot(body.velocity.x, body.velocity.y);
      if (speed > GAME.TRAIL_MIN_SPEED) {
        this.spawnTrailDot();
      }
    }

    if (!this.hasPassedGap && this.ball.y > GAME.LINE_Y + GAME.LINE_HEIGHT) {
      // 実際の（伸縮後の）ライン位置で判定
      const leftInnerX = this.leftLine.x + this.leftLine.width / 2;
      const rightInnerX = this.rightLine.x - this.rightLine.width / 2;
      if (this.ball.x > leftInnerX && this.ball.x < rightInnerX) {
        this.onPassThroughGap();
        return;
      }
    }

    if (this.ball.y > GAME.HEIGHT + 200 || this.ball.x < -200 || this.ball.x > GAME.WIDTH + 200) {
      this.triggerGameOver();
    }
  }

  private onPassThroughGap() {
    this.hasPassedGap = true;
    this.isScrolling = true;

    const isPerfect = this.bounceCount === 0;
    const points = isPerfect ? 1 + GAME.NO_BOUNCE_BONUS : 1;
    this.score += points;
    this.scoreText.setText(this.score.toString());

    if (isPerfect) {
      this.perfectStreak += 1;
    }

    this.stopWarning();
    this.popScore();
    this.flashScreen();
    const particleCount = isPerfect
      ? GAME.PARTICLE_COUNT + GAME.PERFECT_PARTICLE_COUNT
      : GAME.PARTICLE_COUNT;
    this.emitBurst(this.ball.x, GAME.LINE_Y, particleCount);
    this.spawnScorePopup(this.ball.x, GAME.LINE_Y, points, isPerfect);
    if (isPerfect) {
      this.spawnPerfectText(this.perfectStreak);
      playPerfectPass(this.perfectStreak * GAME.FALL_STREAK_PITCH_CENTS);
      vibrate([0, 40, 30, 40, 30, 60]);
    } else {
      playPass();
      vibrate([0, 25, 40, 25]);
    }

    const body = this.ball.body as Phaser.Physics.Arcade.Body;
    body.enable = false;

    const oldLeft = this.leftLine;
    const oldRight = this.rightLine;

    this.tweens.add({
      targets: [oldLeft, oldRight],
      y: -GAME.LINE_HEIGHT,
      duration: GAME.SCROLL_DURATION,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        oldLeft.destroy();
        oldRight.destroy();
      },
    });

    this.tweens.add({
      targets: this.ball,
      y: GAME.BALL_START_Y,
      duration: GAME.SCROLL_DURATION,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.gapWidth = Math.max(
          this.ballDiameter + GAME.GAP_MIN_MARGIN,
          this.gapWidth - GAME.GAP_REDUCTION,
        );
        this.updateBgColor();

        if (this.ballDiameter > this.gapWidth) {
          body.enable = true;
          this.triggerGameOver();
          return;
        }

        this.randomizeGapCenter();
        this.createLines();

        this.leftLine.y = GAME.HEIGHT + GAME.LINE_ENTER_OFFSET_PX;
        this.rightLine.y = GAME.HEIGHT + GAME.LINE_ENTER_OFFSET_PX;
        this.tweens.add({
          targets: [this.leftLine, this.rightLine],
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

  private spawnTrailDot() {
    const radius = this.ballDiameter / 2;
    const dot = this.add.circle(
      this.ball.x, this.ball.y, radius,
      this.ball.fillColor, GAME.TRAIL_ALPHA,
    ).setDepth(this.ball.depth - 1);
    this.tweens.add({
      targets: dot,
      alpha: 0,
      scale: 0.3,
      duration: GAME.TRAIL_DURATION_MS,
      ease: 'Quad.easeOut',
      onComplete: () => dot.destroy(),
    });
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
      targets: [this.leftLine, this.rightLine],
      alpha: 0.35,
      duration: GAME.WARNING_PULSE_DURATION_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.leftLine.setFillStyle(0xff4830);
    this.rightLine.setFillStyle(0xff4830);
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
  }

  private updateBallColor() {
    const t = (this.ballDiameter - GAME.BALL_INITIAL_DIAMETER) / GAME.BALL_COLOR_RANGE_PX;
    const c = lerpColor(GAME.BALL_COLOR_START, GAME.BALL_COLOR_END, t);
    this.ball.setFillStyle(c);
  }

  private updateBgColor() {
    const ratio = this.gapWidth / this.ballDiameter;
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

  private spawnScorePopup(x: number, y: number, points: number, special: boolean) {
    const text = this.add.text(x, y, `+${points}`, {
      fontSize: special ? '88px' : '64px',
      color: special ? '#ffd700' : '#ffeb70',
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

  private spawnPerfectText(streak: number) {
    const label = streak > 1 ? `PERFECT!×${streak}` : 'PERFECT!';
    const text = this.add.text(GAME.WIDTH / 2, GAME.HEIGHT / 2 - 80, label, {
      fontSize: '88px',
      color: '#ffd700',
      fontStyle: 'bold',
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

  private emitBounceBurst(x: number, y: number) {
    for (let i = 0; i < GAME.BOUNCE_PARTICLE_COUNT; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.7;
      const speed = Phaser.Math.FloatBetween(
        GAME.BOUNCE_PARTICLE_SPEED_MIN,
        GAME.BOUNCE_PARTICLE_SPEED_MAX,
      );
      const size = Phaser.Math.Between(2, 4);
      const p = this.add.circle(x, y, size, this.ball.fillColor)
        .setDepth(850)
        .setAlpha(0.9);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * speed * 0.45,
        y: y + Math.sin(angle) * speed * 0.45,
        alpha: 0,
        scale: 0.3,
        duration: GAME.BOUNCE_PARTICLE_DURATION_MS,
        ease: 'Quad.easeOut',
        onComplete: () => p.destroy(),
      });
    }
  }

  private emitBurst(x: number, y: number, count: number) {
    for (let i = 0; i < count; i++) {
      const baseAngle = (i / count) * Math.PI * 2;
      const angle = baseAngle + (Math.random() - 0.5) * 0.6;
      const speed = Phaser.Math.FloatBetween(GAME.PARTICLE_SPEED_MIN, GAME.PARTICLE_SPEED_MAX);
      const size = Phaser.Math.Between(3, 6);
      const p = this.add.circle(x, y, size, GAME.BALL_COLOR).setDepth(900);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * speed * 0.7,
        y: y + Math.sin(angle) * speed * 0.7,
        alpha: 0,
        scale: 0.2,
        duration: GAME.PARTICLE_DURATION_MS,
        ease: 'Quad.easeOut',
        onComplete: () => p.destroy(),
      });
    }
  }

  private triggerGameOver() {
    if (this.isGameOver) return;
    this.isGameOver = true;

    this.stopWarning();
    muteFallSound();
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

    this.cameras.main.shake(GAME.SHAKE_GAMEOVER_DURATION_MS, GAME.SHAKE_GAMEOVER_INTENSITY);
    playGameOver();
    vibrate([0, 60, 30, 120]);

    this.time.delayedCall(700, () => {
      this.scene.start('Result', { score: this.score });
    });
  }
}
