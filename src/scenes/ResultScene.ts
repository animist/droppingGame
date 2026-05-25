import Phaser from 'phaser';
import { GAME, STORAGE_KEYS } from '../config/balance';
import { playResultMelody } from '../audio/sfx';

interface ResultData {
  score: number;
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

    this.cameras.main.fadeIn(300, 0, 0, 0);
    playResultMelody();

    this.add.text(cx, cy - 240, 'GAME OVER', {
      fontSize: '88px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(cx, cy - 80, 'SCORE', {
      fontSize: '40px',
      color: '#aaaaff',
    }).setOrigin(0.5);

    const scoreText = this.add.text(cx, cy - 10, '0', {
      fontSize: '128px',
      color: '#ffeb70',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(cx, cy + 110, `BEST  ${best}`, {
      fontSize: '44px',
      color: '#aaaaff',
    }).setOrigin(0.5);

    const newBestText = isNewBest
      ? this.add.text(cx, cy + 170, 'NEW BEST!', {
          fontSize: '40px',
          color: '#ff70a0',
          fontStyle: 'bold',
        }).setOrigin(0.5).setAlpha(0).setScale(0.5)
      : null;

    const retry = this.add.text(cx, cy + 320, 'TAP TO RETRY', {
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

    const countDuration = Math.min(900, 200 + data.score * 60);

    const finishCountUp = () => {
      scoreText.setText(data.score.toString());
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
        this.restarting = true;
        this.cameras.main.fadeOut(200, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => {
          this.scene.start('Title');
        });
      });
    });
  }
}
