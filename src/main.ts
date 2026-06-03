import Phaser from 'phaser';
import { GAME } from './config/balance';
import { initQuality } from './config/quality';
import { setAudioSuspended } from './audio/sfx';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { GameScene } from './scenes/GameScene';
import { ResultScene } from './scenes/ResultScene';
import { SoundTestScene } from './scenes/SoundTestScene';

// 起動前に品質ティアを推定（glow有無・トレイル間隔・パーティクル数の出し分けに使う）。
// ※ Scale.FIT + 720x1280 固定なので内部描画解像度は端末DPRに依らず一定。
//   そのためDPRキャップは不要（高密度画面でも描画ピクセルは増えない）。
initQuality();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: GAME.BG_COLOR,
  scale: {
    mode: Phaser.Scale.FIT,
    // 中央寄せは CSS(#game の flex)側に任せる。Phaser のマージン中央寄せと
    // 二重にかかると縦横比次第でズレるため NO_CENTER にする。
    autoCenter: Phaser.Scale.NO_CENTER,
    width: GAME.WIDTH,
    height: GAME.HEIGHT,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: GAME.GRAVITY },
      debug: false,
    },
  },
  scene: [BootScene, TitleScene, GameScene, ResultScene, SoundTestScene],
};

const game = new Phaser.Game(config);

// 縦向きロックのベストエフォート（フルスクリーン＋対応端末でのみ成功。
// iOS Safari などは未対応 → CSSオーバーレイ側でフォローする）
const orientation = screen.orientation as ScreenOrientation & {
  lock?: (o: string) => Promise<void>;
};
if (orientation && typeof orientation.lock === 'function') {
  orientation.lock('portrait').catch(() => {
    // 未対応／フルスクリーン外では失敗するが問題なし（オーバーレイで案内）
  });
}

// 横向き中はゲームをポーズ、縦に戻ったら再開 + 描画領域を再計算。
// CSSオーバーレイの表示条件（landscape かつ max-height:600px）と揃える。
const landscapeQuery = window.matchMedia('(orientation: landscape) and (max-height: 600px)');

function applyOrientationState() {
  const isLandscape = landscapeQuery.matches;
  if (isLandscape) {
    // 横向き: 動いているシーンのゲームループを止める + 音も一括サスペンド
    game.scene.getScenes(true).forEach((s) => game.scene.pause(s.scene.key));
    setAudioSuspended(true);
  } else {
    // 縦向き復帰: 再開
    game.scene.getScenes(false).forEach((s) => {
      if (game.scene.isPaused(s.scene.key)) game.scene.resume(s.scene.key);
    });
    setAudioSuspended(false);
    // orientation変更後やアドレスバー出入りで FIT が古い寸法のままになることがあるため
    // 明示的にスケールを再計算して描画領域を最大化する（数フレーム分念押し）
    requestAnimationFrame(() => game.scale.refresh());
    setTimeout(() => game.scale.refresh(), 250);
  }
}

// 初回 + 変化時に反映
if (landscapeQuery.addEventListener) {
  landscapeQuery.addEventListener('change', applyOrientationState);
} else {
  // 古いSafari向けフォールバック
  landscapeQuery.addListener(applyOrientationState);
}
window.addEventListener('orientationchange', () => {
  // orientationchange直後はサイズが安定しないので少し待ってから反映
  setTimeout(applyOrientationState, 150);
});
window.addEventListener('resize', () => game.scale.refresh());
game.events.once(Phaser.Core.Events.READY, applyOrientationState);
