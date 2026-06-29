/**
 * 隠しデバッグモードの状態（タイトルロゴを規定回数タップで ON）。
 * ON のときの Game は: 穴を広く / 穴を縮めない / スコアを保存しない。
 * 音や演出のテストを、ゲームオーバーに邪魔されず行うための開発用モード。
 *
 * タイトルに入るたびに TitleScene 側で false へリセットされ、即リトライ（Result→Game）の
 * 間は維持される（モジュールスコープの値が保持されるため）。
 */
let debugMode = false;

export function getDebugMode(): boolean {
  return debugMode;
}

export function setDebugMode(v: boolean): void {
  debugMode = v;
}
