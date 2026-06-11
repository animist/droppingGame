import Phaser from 'phaser';
import { GAME, STORAGE_KEYS } from '../config/balance';
import { FONT_FAMILY } from '../config/ui';
import { playResultMelody } from '../audio/sfx';
import { addBackgroundShade } from '../util/bgShade';

interface ResultData {
  score: number;
  perfects?: number;   // PERFECT総数
  maxStreak?: number;  // PERFECT最大連続数
  closes?: number;     // CLOSE（ニアミス通過）総数
}

const INPUT_GRACE_MS = 400;

export class ResultScene extends Phaser.Scene {
  private restarting = false;

  constructor() {
    super('Result');
  }

  create(data: ResultData) {
    this.restarting = false;

    const cx = GAME.WIDTH / 2;
    const cy = GAME.HEIGHT / 2;
    let best = 0;
    try {
      best = Number(localStorage.getItem(STORAGE_KEYS.HIGH_SCORE) ?? 0);
    } catch {
      best = 0;
    }
    const isNewBest = data.score >= best && data.score > 0;

    addBackgroundShade(this, -1);

    this.cameras.main.fadeIn(300, 0, 0, 0);
    playResultMelody();

    // 縦レイアウト: M PLUS Rounded 1c は行高が大きく、テキストボックスが
    // フォントサイズの約1.4倍になる。スコアの脈動（×1.2）も考慮して
    // 各要素の中心Y座標を余裕を持って離す。
    this.add.text(cx, cy - 260, 'GAME OVER', {
      fontFamily: FONT_FAMILY,
      fontSize: '88px',
      color: '#ffffff',
      fontStyle: '800',
    }).setOrigin(0.5);

    this.add.text(cx, cy - 150, 'SCORE', {
      fontFamily: FONT_FAMILY,
      fontSize: '40px',
      color: '#aaaaff',
    }).setOrigin(0.5);

    const scoreText = this.add.text(cx, cy - 32, '0', {
      fontFamily: FONT_FAMILY,
      fontSize: '128px',
      color: '#ffeb70',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(cx, cy + 135, `BEST  ${best}`, {
      fontFamily: FONT_FAMILY,
      fontSize: '44px',
      color: '#aaaaff',
    }).setOrigin(0.5);

    const newBestText = isNewBest
      ? this.add.text(cx, cy + 205, 'NEW BEST!', {
          fontFamily: FONT_FAMILY,
          fontSize: '40px',
          color: '#ff70a0',
          fontStyle: 'bold',
        }).setOrigin(0.5).setAlpha(0).setScale(0.5)
      : null;

    // プレイ内訳（実績のあった項目だけを1行で表示。カウントアップ完了後にフェードイン）
    // NEW BEST がないときはその空きを詰めて表示する
    const parts: string[] = [];
    if (data.perfects) parts.push(`PERFECT ×${data.perfects}`);
    if (data.maxStreak && data.maxStreak >= 2) parts.push(`COMBO ×${data.maxStreak}`);
    if (data.closes) parts.push(`CLOSE ×${data.closes}`);
    const breakdownY = isNewBest ? cy + 275 : cy + 215;
    const breakdownText = parts.length
      ? this.add.text(cx, breakdownY, parts.join('   '), {
          fontFamily: FONT_FAMILY,
          fontSize: '30px',
          color: '#cfcfe8',
        }).setOrigin(0.5).setAlpha(0)
      : null;

    const retry = this.add.text(cx, cy + 370, 'TAP TO RETRY', {
      fontFamily: FONT_FAMILY,
      fontSize: '56px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.tweens.add({
      targets: retry,
      alpha: 0.3,
      duration: 800,
      yoyo: true,
      repeat: -1,
    });

    // タイトルへ戻る小さなボタン（リトライは画面全体タップで即 Game へ）
    const homeBtn = this.add.text(cx, GAME.HEIGHT - 90, 'HOME', {
      fontFamily: FONT_FAMILY,
      fontSize: '32px',
      color: '#aaaacc',
      backgroundColor: '#2a2a4a',
      padding: { left: 32, right: 32, top: 12, bottom: 12 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    // GameObject の pointerdown はシーンの pointerdown より先に発火するため、
    // ここで restarting を立てれば全画面リトライとは競合しない
    homeBtn.on('pointerdown', () => {
      if (this.restarting) return;
      this.restarting = true;
      this.cameras.main.fadeOut(200, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('Title');
      });
    });

    const countDuration = Math.min(900, 200 + data.score * 60);

    const finishCountUp = () => {
      scoreText.setText(data.score.toString());
      if (breakdownText) {
        this.tweens.add({
          targets: breakdownText,
          alpha: 1,
          duration: 350,
          ease: 'Quad.easeOut',
        });
      }
      if (isNewBest) {
        scoreText.setColor('#ffd700');
        this.tweens.add({
          targets: scoreText,
          scale: 1.2,
          duration: 180,
          yoyo: true,
          repeat: 2,
          ease: 'Sine.easeInOut',
        });
        if (newBestText) {
          this.tweens.add({
            targets: newBestText,
            alpha: 1,
            scale: 1,
            duration: 300,
            ease: 'Back.easeOut',
          });
        }
      }
    };

    const counter = { v: 0 };
    const countTween = this.tweens.add({
      targets: counter,
      v: data.score,
      duration: countDuration,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        scoreText.setText(Math.floor(counter.v).toString());
      },
      onComplete: finishCountUp,
    });

    this.time.delayedCall(INPUT_GRACE_MS, () => {
      this.input.on('pointerdown', () => {
        if (this.restarting) return;
        if (countTween.isPlaying()) {
          countTween.stop();
          finishCountUp();
          return;
        }
        // 即リトライ: Title を経由せず直接 Game へ（音声・傾きセンサーは初回 Title で許可済み）
        this.restarting = true;
        this.cameras.main.fadeOut(200, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => {
          this.scene.start('Game');
        });
      });
    });
  }
}
