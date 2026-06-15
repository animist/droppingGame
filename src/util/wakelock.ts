/**
 * Screen Wake Lock。傾き操作中はタッチが無いため OS に無操作と判断され画面がスリープしがち。
 * これを抑止する。HTTPS（secure context）かつ対応ブラウザでのみ有効、非対応時は黙って何もしない。
 *
 * 注意: Wake Lock はタブが非表示になると自動解放されるため、再表示時に取り直す。
 */

interface WakeLockSentinelLike {
  release: () => Promise<void>;
  addEventListener: (type: 'release', cb: () => void) => void;
}
interface WakeLockLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
}

function getWakeLock(): WakeLockLike | undefined {
  return (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
}

let sentinel: WakeLockSentinelLike | null = null;
let want = false; // 取得したい状態か（再取得の判断に使う）

async function acquire() {
  if (!want || sentinel) return;
  const wl = getWakeLock();
  if (!wl) return;
  try {
    sentinel = await wl.request('screen');
    // OS/ブラウザ都合で解放されたら参照を捨てる（visibilitychange で取り直す）
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    // 取得失敗（権限なし・非対応・ユーザー操作外など）は無視
    sentinel = null;
  }
}

/** スリープ抑止を有効化（ユーザー操作起点で呼ぶのが確実）。 */
export function enableWakeLock() {
  want = true;
  void acquire();
}

/** スリープ抑止を解除。 */
export function disableWakeLock() {
  want = false;
  void sentinel?.release().catch(() => {});
  sentinel = null;
}

// タブ復帰時に取り直す（非表示中に解放されるため）
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void acquire();
  });
}
