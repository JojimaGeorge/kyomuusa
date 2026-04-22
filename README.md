# きょむうさ猛プッシュ

CasLive LP埋め込み用ミニゲーム。縦型スマホビュー、連打型、10秒クリア設計。

## 構成

```
index.html          メインHTML
style.css           スタイル
game.js             ゲームロジック
assets/
  title_BG.png      タイトル画面背景（ロゴ込み）※今はSVGプレースホルダ
  room_BG.png       ゲーム画面背景           ※今はSVGプレースホルダ
  kyomuusa_idle.gif    段階0：無関心        ※今はSVGプレースホルダ
  kyomuusa_interest.gif 段階1：耳ピク
  kyomuusa_excited.gif  段階2：前のめり
  kyomuusa_smile.gif    段階3：満タン笑顔
```

### アセット差し替え手順

1. 実アセット（PNG / GIF）を `assets/` に上記ファイル名で配置
2. `game.js` 冒頭の `ASSETS` 定数は `.gif → .svg` のフォールバック順で自動解決するため、ファイルが存在すればそのまま切り替わる
3. ブラウザキャッシュ注意 — ハードリロードで確認

## 調整ポイント（チューニング変数）

`game.js` 冒頭の `TUNING` オブジェクトで全て調整可能。ブラウザの Tweaks パネル（右下）からもライブで変更可能で、その変更はファイルに永続化される。

| キー | 初期値 | 役割 |
|------|------|------|
| `gaugePerTap` | 2.3 | 1タップあたりのゲージ増加量（% / tap）|
| `gaugeDecayPerSec` | 1.5 | 手を止めたときの毎秒減衰量（% / sec）|
| `targetTaps` | 50 | 理想タップ数（参考値、UIロジックには未使用）|
| `targetTimeSec` | 12 | 想定クリア秒数（タイマー表示用）|
| `effectIntensity` | 9 | パーティクル量・シェイク幅のベース倍率（0-10）|
| `hologramStrength` | 7 | ホログラム／キラキラ背景の濃さ（0-10）|
| `shakeEnabled` | true | 画面シェイクON/OFF |
| `flashEnabled` | true | 白フラッシュON/OFF |

### ゲージ段階しきい値
`game.js` の `STAGES` 配列で変更：

```js
const STAGES = [
  { at: 0,   key: 'idle' },
  { at: 30,  key: 'interest' },
  { at: 70,  key: 'excited' },
  { at: 100, key: 'smile' },
];
```

## タップフィールの仕組み

1タップあたり同時発火：
- ボタン `scale(0.92)` → `elastic.out` で弾性復元
- リップル波紋（0.6s）
- 星／ドット／ハートの多色パーティクル散布（量は `effectIntensity` と連打速度に連動）
- `+1 / +2 / +3` コンボ数字ポップアップ（5連ごと `big`、10連ごと `mega`）
- 画面シェイク 2-3px
- 白フラッシュ 80ms
- ゲージのパルスリング
- 連打速度 < 150ms でエフェクト量＋色変化ブースト

## BGM / SE 差し込みポイント

`index.html` 内にコメントで明記。`<audio>` タグのsrc差し替えで有効化。
- `#bgm-title` — タイトルBGM
- `#bgm-game` — ゲームBGM
- `#se-tap` — タップSE（`game.js` の `handleTap` 内で `el.currentTime = 0; el.play()`）
- `#se-clear` — クリアSE

## 技術

- Vanilla JS + GSAP 3.12（演出用のみ）
- 60fps目標、パーティクルは `requestAnimationFrame` 管理
- `touch-action: manipulation`、`touchstart` 即応、`mousedown` / `touchstart` 二重発火防止
- モバイルSafariの long-press コンテキストメニュー抑制
- GIFちらつき防止：`src` 再代入によるループリセット、全アセット `new Image()` プリロード
- アクセシビリティ：`prefers-reduced-motion` 対応
- スペースキーでデスクトップタップ可能（開発用）
