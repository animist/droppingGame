export const GAME = {
  // --- キャンバス / 物理基礎 ---
  WIDTH: 720,                          // ゲーム内仮想解像度の幅（px）。実機表示はScale.FITで縮小される
  HEIGHT: 1280,                        // ゲーム内仮想解像度の高さ（px）。縦9:16基準
  GRAVITY: 400,                        // 落下加速度（px/s²）。大きいほど球が早く落ちる
  BOUNCE: 0.85,                        // 線にぶつかった時の反発係数（0〜1）。1で同じ高さまで戻る、0で跳ねない
  WALL_BOUNCE: 1.0,                    // 左右の壁での反発係数。1.0でエネルギーロスなく跳ね返る

  // --- ボール ---
  BALL_INITIAL_DIAMETER: 30,           // ボール初期サイズ（px）
  BALL_GROWTH_PER_BOUNCE: 2,           // 線にバウンドするごとに直径が何px増えるか
  BALL_START_Y: 200,                   // ゲーム開始時およびスクロール後のボール出現Y座標

  // --- 隙間（難易度） ---
  GAP_INITIAL: 180,                    // 最初の隙間幅（px）。大きいほど序盤が楽
  GAP_REDUCTION: 6,                    // 通過ごとに隙間が何px狭くなるか
  GAP_MIN_MARGIN: 10,                  // 隙間幅の下限（ボール直径+この値）。これ以下にはならない
  LINE_SEGMENT_MIN_WIDTH: 80,          // 左右の線の最小長（px）。隙間位置をランダム化する際の制約
  NO_BOUNCE_BONUS: 2,                  // バウンドなしで通過した場合のボーナス加算（通常+1に加えて）
  END_COLOR_BONUS: 10,                 // ボールが終端色に近い状態で穴を通過した時のボーナス加算。PERFECT時はこの倍。
  END_COLOR_BONUS_THRESHOLD: 0.75,     // 終端色ボーナス発動の閾値。ボール色の進行度(0=初期色, 1=完全に終端色)がこの値以上で発動。
                                       // 1.0で「完全に赤くなったとき」、0.0で「少しでも変色したら」発動。低いほど甘い判定。

  // --- ライン伸縮（運要素） ---
  LINE_OSCILLATION_AMPLITUDE_PX: 3,    // ラインの伸縮振幅（±この値）
  LINE_OSC_FREQ_LEFT: 5.0,             // 左ラインの伸縮角速度（rad/s）。周期は 2π÷この値
  LINE_OSC_FREQ_RIGHT: 5.8,            // 右ラインの伸縮角速度（左と少しずらして独立感を出す）
  LINE_OSC_PHASE_RIGHT: 1.5,           // 右ラインの位相オフセット（rad）

  // --- 線（バウンドする床） ---
  LINE_HEIGHT: 3,                     // 線の太さ（px）
  LINE_Y: 1080,                        // 線が配置されるY座標（画面下寄り）
  LINE_COLOR: 0x70d6ff,                // 通常時の線の色（水色）

  // --- 色（ボール・背景の段階変化） ---
  BALL_COLOR: 0xffeb70,                // ボールのデフォルト色（互換用、未使用化方向）
  BALL_COLOR_START: 0xffeb70,          // ボール初期色（黄色）
  BALL_COLOR_END: 0xff4830,            // ボール終端色（赤）
  // ボール色は「ボール直径 / 現在の穴幅」の比率で決まる（穴に対する余裕度）。
  // 比率が小さい（穴に対して余裕）= 開始色、比率が大きい（穴ギリギリ）= 終端色。
  BALL_COLOR_RATIO_START: 0.4,          // この比率以下なら開始色（黄）のまま
  BALL_COLOR_RATIO_END: 0.95,           // この比率以上で終端色（赤）に到達
  BG_COLOR: '#1a1a2e',                 // ゲーム全体のキャンバス背景色（Phaser config用、文字列）
  BG_COLOR_START: 0x1a1a2e,            // ゲーム中の背景初期色（青紫）
  BG_COLOR_END: 0x4a081f,              // ゲーム中の背景終端色（赤紫）
  // 背景色は「隙間幅 / ボール直径」の比率で進行する（スコアではなく難易度ベース）。
  // 比率が大きいほど START 色（余裕あり）、小さいほど END 色（ギリギリ）。
  BG_GAP_RATIO_START: 2.0,             // 比率がこれ以上なら背景は完全に START 色（青紫）
  BG_GAP_RATIO_25: 1.5,                // 比率がこれを下回ると 25% 混合
  BG_GAP_RATIO_50: 1.25,               // 比率がこれを下回ると 50% 混合（中間色）
  BG_GAP_RATIO_END: 1.1,               // 比率がこれ以下なら完全に END 色（赤紫）

  // --- 操作（スワイプ / 傾き） ---
  DRAG_X: 200,                         // 横方向の空気抵抗（px/s²の減速）。大きいほどボールが早く止まる
  SWIPE_IMPULSE_FACTOR: 5,             // スワイプ移動量×この値が横方向のインパルスになる
  SWIPE_DEAD_ZONE_PX: 0.5,             // この距離未満の指のブレは無視
  TILT_FACTOR: 50,                     // 端末傾き角度（度）×この値×秒が横方向加速度
  TILT_DEAD_ZONE_DEG: 5,               // この角度未満の傾きは無視（手ブレ対策）
  MAX_VELOCITY: 2000,                  // ボールの最大速度（px/s、横縦両方）

  // --- スクロール演出（隙間通過時） ---
  SCROLL_DURATION: 400,                // 古い線が上に消えていく時間（ms）
  LINE_ENTER_DURATION_MS: 320,         // 新しい線が下から登場する時間（ms）
  LINE_ENTER_OFFSET_PX: 60,            // 新しい線が画面下から何px下に出現するか（登場アニメ用）

  // --- バウンド演出 ---
  SQUASH_SCALE_X: 1.3,                 // 接地時の横方向スクワッシュ倍率
  SQUASH_SCALE_Y: 0.7,                 // 接地時の縦方向スクワッシュ倍率（潰れ具合）
  SQUASH_DURATION_MS: 80,              // 潰れ→膨らみ への移行時間（ms）
  EXPAND_SCALE: 1.5,                  // 膨らみフェーズの倍率（大きくなる印象を強調）
  SETTLE_DURATION_MS: 130,             // 膨らみ→元サイズ に戻る時間（ms）

  // バウンス時に上方向へ飛び散るパーティクル
  BOUNCE_PARTICLE_COUNT: 12,            // 1回のバウンスで飛び散る粒の数
  BOUNCE_PARTICLE_SPEED_MIN: 200,      // 粒の速度下限
  BOUNCE_PARTICLE_SPEED_MAX: 400,      // 粒の速度上限
  BOUNCE_PARTICLE_DURATION_MS: 360,    // 粒が消えるまでの時間（ms）

  // --- 隙間通過演出 ---
  FLASH_ALPHA: 0.4,                    // 通過時の画面全体フラッシュの不透明度（0〜1）
  FLASH_DURATION_MS: 150,              // フラッシュが消えるまでの時間（ms）
  PARTICLE_COUNT: 12,                  // 通過時に放射状に飛ぶ粒の数
  PARTICLE_SPEED_MIN: 200,             // 通過パーティクルの速度下限
  PARTICLE_SPEED_MAX: 450,             // 通過パーティクルの速度上限
  PARTICLE_DURATION_MS: 450,           // 通過パーティクルの持続時間（ms）
  SCORE_POP_SCALE: 1.3,                // 通過時にHUDスコア文字が一瞬拡大する倍率
  SCORE_POP_DURATION_MS: 100,          // スコア拡大→戻し のうち拡大フェーズ時間（ms）

  // --- カメラシェイク ---
  SHAKE_BASE_INTENSITY: 0.003,         // バウンド時シェイクの基準強度（ボールサイズに比例）
  SHAKE_BASE_DURATION_MS: 60,          // バウンド時シェイクの持続時間（ms）
  SHAKE_GAMEOVER_DURATION_MS: 400,     // ゲームオーバー時シェイクの持続時間（ms）
  SHAKE_GAMEOVER_INTENSITY: 0.015,     // ゲームオーバー時シェイクの強度

  // --- 通過時の "+1" ポップアップ ---
  SCORE_POPUP_RISE_PX: 120,            // +1テキストが何px浮上するか
  SCORE_POPUP_DURATION_MS: 700,        // +1テキストが消えるまでの時間（ms）

  // --- 常時パーティクル（落下中のきらめき） ---
  AMBIENT_INTERVAL_MS: 90,             // 粒を撒く間隔（ms）。小さいほど密
  AMBIENT_MIN_SPEED: 120,              // この速度（px/s）未満では撒かない（ほぼ静止中は出さない）
  AMBIENT_SIZE_MIN: 2,                 // 粒の最小半径（px）
  AMBIENT_SIZE_MAX: 4,                 // 粒の最大半径（px）
  AMBIENT_DURATION_MS: 550,            // 粒が消えるまでの時間（ms）
  AMBIENT_DRIFT_PX: 70,                // 粒がランダムに漂う距離（px）
  AMBIENT_STREAK_MAX: 6,               // PERFECTコンボによる追加粒数の上限（1コンボ=+1粒）
  AMBIENT_GOLD_RATIO: 0.6,             // コンボ中に金色の粒が混ざる割合（0〜1）

  // --- ボールのトレイル（残像） ---
  TRAIL_INTERVAL_MS: 30,               // 残像を1個生成する間隔（ms）。小さいほど密
  TRAIL_DURATION_MS: 280,              // 残像1個が消えるまでの時間（ms）
  TRAIL_ALPHA: 0.35,                   // 残像の初期不透明度
  TRAIL_MIN_SPEED: 250,                // この速度未満の時は残像を生成しない

  // --- 危険警告（隙間ギリギリの時の線の点滅） ---
  WARNING_THRESHOLD: 0.85,             // ボール直径/隙間幅 がこの比率を超えたら警告開始
  WARNING_PULSE_DURATION_MS: 400,      // 警告点滅の1サイクル時間（ms）
  WARNING_VIGNETTE_ALPHA: 0.22,        // 警告中に脈動する赤ビネットの最大不透明度（0で無効）
  MUSIC_MUFFLE_HZ: 420,                // 警告中にBGMへかけるローパスの周波数（Hz）。低いほどこもる

  // --- 隙間端マーカー（ラインの内側端の発光点） ---
  GAP_MARKER_RADIUS: 7,                // マーカーの半径（px）。隙間の端の視認性を上げる
  GAP_MARKER_COLOR: 0xbff0ff,          // マーカーの色（ライン色より明るい水色）

  // --- ベロシティストレッチ（移動中のボール変形） ---
  STRETCH_MIN_SPEED: 240,              // この速度（px/s）未満では変形しない
  STRETCH_MAX_SPEED: 1500,             // この速度で伸びが最大になる
  STRETCH_MAX: 0.22,                   // 最大伸び率（0.22=進行方向に+22%、直交方向は6割相当つぶれ）

  // --- 死亡演出 ---
  DEATH_PARTICLE_COUNT: 26,            // ボール破裂時のパーティクル数
  DEATH_PARTICLE_SPEED_MIN: 250,       // 破裂パーティクルの速度下限
  DEATH_PARTICLE_SPEED_MAX: 700,       // 破裂パーティクルの速度上限
  DEATH_PARTICLE_DURATION_MS: 700,     // 破裂パーティクルが消えるまでの時間（ms）
  DEATH_SLOWMO_SCALE: 0.5,             // 死亡直後の演出スロー倍率（tweenのみ減速）
  DEATH_SLOWMO_MS: 280,                // スローを維持する実時間（ms）
  DEATH_DESAT_ALPHA: 0.45,             // 彩度抜きオーバーレイ（暗幕）の最終不透明度
  DEATH_RESULT_DELAY_MS: 1500,         // ゲームオーバーから Result へ遷移するまでの時間（ms）

  // --- 落下音（風切り音、速度連動） ---
  FALL_SOUND_MAX_VELOCITY: 800,        // この下向き速度で音量・周波数が最大になる
  FALL_SOUND_MAX_GAIN: 0.2,           // 落下音の最大音量（0〜1、効果音全体に対する比率）
  FALL_OSC_TYPE: 'triangle' as OscillatorType,  // 基音波形。'sawtooth'(鋭い)/'triangle'(柔らかい)/'sine'(純音)/'square'(矩形)
  FALL_OSC_FREQ_BASE: 240,             // 静止時の基音周波数（Hz）。高くすると常時高音
  FALL_OSC_FREQ_RANGE: 400,            // 速度最大時に基音がここまで上昇（Hz）。基音は BASE → BASE+RANGE
  FALL_FILTER_Q: 6,                    // バンドパスの共振強度。1〜2でゆるく、4〜6で「ホイッスル」感が強まる
  FALL_FILTER_FREQ_BASE: 900,          // 静止時のバンドパス中心周波数（Hz）
  FALL_FILTER_FREQ_RANGE: 2400,        // 速度最大時にバンドパス中心がここまで上昇（Hz）
  FALL_UPWARD_DETUNE_CENTS: -150,      // 上昇中の音程シフト（cents、100=半音）。-100〜-300 でわかりやすく逆の音色に。0で無効
  FALL_STREAK_PITCH_CENTS: 150,        // パーフェクト連続1回ごとに加算される音程シフト（cents）。250=長3度、200=長2度

  // --- パーフェクト演出（ノーバウンス通過時） ---
  PERFECT_TEXT_DURATION_MS: 800,       // "PERFECT!"テキスト表示の総時間（ms）
  PERFECT_PARTICLE_COUNT: 18,          // パーフェクト時の追加パーティクル数

  // --- ニアミス演出（ギリギリ通過）---
  NEAR_MISS_CLEARANCE_PX: 14,          // ボール端〜ライン端の余白がこの値以下ならニアミス
  NEAR_MISS_BONUS: 2,                   // ニアミス（CLOSE）通過時のボーナス加算
  NEAR_MISS_ZOOM: 2.2,                 // ニアミス時のカメラズーム倍率（ボール位置を固定したまま寄る）
  NEAR_MISS_ZOOM_IN_MS: 200,           // ズームインにかける時間（ms）
  NEAR_MISS_HOLD_MS: 160,              // 最大ズームを保持する時間（ms、ストップモーション）
  NEAR_MISS_ZOOM_OUT_MS: 280,          // ズームアウト（逆再生）にかける時間（ms）

  // --- マイルストーン演出（スコア節目）---
  MILESTONES: [10, 25, 50, 100, 200, 500] as number[], // この得点に到達で特別演出
  MILESTONE_TEXT_MS: 1100,             // マイルストーンテキストの表示総時間（ms）

  // --- タイムダイレーション（成功時のスローモーション）---
  TIME_DILATION_SCALE: 0.35,           // 通過時に一瞬落とすゲーム速度（0.35=35%速度）
  TIME_DILATION_HOLD_MS: 90,           // スロー状態を維持する実時間（ms）
  TIME_DILATION_RECOVER_MS: 160,       // 通常速度に戻すまでの実時間（ms）

  // --- グロー（発光）演出 ---
  GLOW_BALL_BASE: 4,                   // ボールのグロー基準強度
  GLOW_BALL_MAX: 16,                   // 終端色付近でのボール最大グロー強度
  GLOW_BALL_DISTANCE: 26,              // ボールのグロー拡散距離（px）。大きいほどボヤッと広がる
  GLOW_BALL_QUALITY: 0.2,              // ボールのグローのサンプル品質（0〜1）。距離を伸ばすほど上げないと縞が出る
  GLOW_DISTANCE: 10,                   // ライン等のグロー拡散距離（px）。控えめでシャープ
  GLOW_QUALITY: 0.1,                   // ライン等のグローのサンプル品質
  GLOW_LINE: 6,                        // ラインのグロー強度
  GLOW_BALL_BRIGHTEN: 1.6,             // グロー色をボール色から何倍明るくするか（1=同色, >1=明るい同系色）
  GLOW_PULSE_AMP: 3.5,                 // ボールのグロー強度の揺らぎ幅（±この値で増減）。0で揺らぎなし
  GLOW_PULSE_FREQ: 4.5,                // ボールのグロー揺らぎの速さ（rad/s）。大きいほど速く明滅
  GLOW_LINE_PULSE_AMP: 1.5,            // ラインのグロー揺らぎ幅（基準より小さく、ゼロにならない範囲）
  GLOW_LINE_PULSE_FREQ: 2.0,           // ラインのグロー揺らぎの速さ（ボールより遅め）

  // --- ステレオパン ---
  AUDIO_PAN_STRENGTH: 0.85,            // ボールx位置→音の左右定位の強さ（0=モノ, 1=full）。※モノラルスピーカー機種では効果なし

  // --- 効果音の空間系（フィードバックディレイのセンドバス）---
  // ワンショット効果音だけを薄く山びこさせ、合成音の「素のまま感」を消す。落下音・BGMはドライのまま。
  AUDIO_DELAY_TIME_S: 0.16,            // ディレイタイム（秒）。テンポ感に合わせて 0.12〜0.25 程度
  AUDIO_DELAY_FEEDBACK: 0.30,          // 山びこの繰り返し量（0〜1）。大きいほど長く残る
  AUDIO_DELAY_TONE_HZ: 1800,           // ディレイ音のローパス周波数。低いほどこもった残響になる
  AUDIO_DELAY_SEND: 0.22,              // 原音に対するセンド量（0=無効）。上げすぎると音像がぼやける

  // --- バウンド音の個性（1回ごとのばらつき）---
  BOUNCE_DETUNE_JITTER: 120,           // バウンド音の音程ゆらぎ（±cents、120=約半音）
  BOUNCE_VOLUME_JITTER: 0.4,           // バウンド音の音量ゆらぎ（±割合、0.4=±40%）
  WALL_DETUNE_JITTER: 160,             // 壁音の音程ゆらぎ（±cents）

  // --- BGM（procedural music）---
  MUSIC_TEMPO: 104,                    // BGMのテンポ（BPM）
  MUSIC_VOLUME: 0.5,                   // BGMバスの最大音量（0〜1、SFXとは独立）
  MUSIC_INTENSITY_1: 6,                // スコアこの値以上でアルペジオ追加（intensity 1）
  MUSIC_INTENSITY_2: 16,               // スコアこの値以上でハイハット追加（intensity 2）
  MUSIC_INTENSITY_3: 32,               // スコアこの値以上で上声追加（intensity 3）

  // --- 背景パララックス（奥行きのある動く背景）---
  PARALLAX_DRIFT_SPEED: 1.0,           // 全体のドリフト速度倍率（大きいほど速く流れる）
  PARALLAX_FAR_COUNT: 24,              // 遠景レイヤーの点の数
  PARALLAX_MID_COUNT: 18,               // 中景レイヤーの点の数
  PARALLAX_NEAR_COUNT: 12,              // 近景レイヤーの点の数
};

export const STORAGE_KEYS = {
  HIGH_SCORE: 'dropping.highScore',    // localStorage: 最高スコア
  PLAY_COUNT: 'dropping.playCount',    // localStorage: 累計プレイ回数
};
