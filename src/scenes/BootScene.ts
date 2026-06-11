import Phaser from 'phaser';

// Webフォントの読み込みを待ってから Title へ進む。
// 読み込みが遅い／失敗する環境でもゲームを止めないよう、上限を超えたら
// フォールバックフォントのまま開始する。
const FONT_WAIT_TIMEOUT_MS = 1500;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      this.scene.start('Title');
    };

    const timer = window.setTimeout(start, FONT_WAIT_TIMEOUT_MS);

    if (typeof document !== 'undefined' && document.fonts?.load) {
      Promise.all([
        document.fonts.load('700 32px "M PLUS Rounded 1c"'),
        document.fonts.load('800 32px "M PLUS Rounded 1c"'),
      ])
        .catch(() => {})
        .then(() => {
          window.clearTimeout(timer);
          start();
        });
    } else {
      window.clearTimeout(timer);
      start();
    }
  }
}
