# きょむうさ猛プッシュ

CasLive LP埋め込み用のリズムタップミニゲーム。縦型スマホビュー前提、BGMに乗せて拍点でタップ → 99%で連打フェーズ突入 → クリアでスコア・ランク算出という流れ。

## プレイの流れ

1. **タイトル** (`#scene-title`) — Start ボタンでゲーム開始、BGM開始
2. **ゲーム** (`#scene-game`) — 3曲からランダム選曲、拍点に合わせてタップ。Perfect/Great/Good/Missで判定
3. **連打フェーズ** — ゲージ99%到達で起動。30連打で100%クリア
4. **クリア** (`#scene-clear`) → **動画** (`#scene-video`) → **CTA** (`#scene-cta`) — スコアを段階的に表示、ランクバッジ、SNSシェア

## 構成

```
index.html          メインHTML（5シーン全部内包）
style.css           スタイル（シーン遷移・エフェクト演出含む）
game.js             ゲームロジック
assets/
  musicA.mp3 / musicB.mp3 / musicC.mp3    ゲームBGM 3曲（ランダム選曲）
  music_title.mp3 / music_end.mp3         タイトル・CTA BGM
  SE1.mp3 / SE2.mp3 / SE3.mp3 / SE_clear.mp3  各種SE
  kyomuA/B/C/D/E/F.webp                   キャラGIF（段階進行 + クリア）
  kyomuusa_*.svg                          プレースホルダ（フォールバック用）
  goodicon_01〜07.webp                    判定バッジアイコン
  clearBG.webp / clear_window.webp        クリア画面用
  titleBG.webp / title1.webp / title2.webp  タイトル画面用
  CTA_BG.webp / applogo.webp 等           CTA画面用
tools/
  bpm_analyze.py       BGMのBPM検出
  bpm_drift_check.py   グリッドずれ確認用
  convert_webp.py      アセット一括webp変換
  gen_favicons.py      favicon生成
```

## スコアリング

### タップ判定（リズムフェーズ）

| 判定 | ウィンドウ | ゲージ増加 | 得点 |
|------|---------|---------|----|
| Perfect | ±75ms | +3.85 | 300 × コンボ倍率 |
| Great   | ±140ms | +2.31 | 180 × コンボ倍率 |
| Good    | ±220ms | +1.31 | 90 × コンボ倍率 |
| Miss    | 外し | 0 | 0 |

コンボ倍率 = `1 + min(combo, 30) × 0.05`（最大2.5倍）。
Missでコンボリセット。

### 連打フェーズ（99% → 100%）

- ゲージ99%到達 → 350ms後に連打モード突入
- 30回タップで100%到達 → クリア
- 1タップ +200 点、30回到達時に BREAKTHROUGH 表示
- オーバーシュート（31回目以降）は4重ガードで遮断

### 最終スコア

```
hitScore + timeBonus + accuracyBonus + comboBonus + noMissBonus − decayPenalty
→ efficiencyFactor（タップ数超過で最大0.3まで減衰）を掛けて確定
```

**timeBonus**（リズムクリア時間で評価、マッシュ時間は除外）

| リズムクリア秒数 | ボーナス |
|----|----|
| 16秒 | 8000 |
| 17秒 | 6500 |
| 18秒 | 5000（target） |
| 20秒 | 3000 |
| 22秒 | 1000 |
| 23秒以上 | 0 |

18秒境界で2段階：以内は `5000 + (18 - sec) × 1500`、以上は `max(0, (23 - sec) × 1000)`。

**accuracyBonus** = perfectCount × 400 + greatCount × 150
**comboBonus** = maxCombo × 200
**noMissBonus** = +3000（Miss 0のパーフェクトランボーナス）
**decayPenalty** = 減衰で失ったゲージ量 × 40

### ランク

| ランク | 閾値 |
|------|----|
| S | 25000以上 |
| A | 23000以上 |
| B | 21000以上 |
| C | 19000以上 |
| D | 19000未満 |

## BGM / BPMチューニング

3曲（A/B/C）各々のBPMとoffset（最初の拍までの遅延ms）を個別設定。

```js
// game.js 内 GAME_BGM_TRACKS
{ src: './assets/musicA.mp3', bpm: 130.97, offsetMs: 487, title: 'Milky CasWay' },
{ src: './assets/musicB.mp3', bpm: 132.06, offsetMs: 558, title: 'Parallel CasNight' },
{ src: './assets/musicC.mp3', bpm: 131.50, offsetMs: 892, title: 'Signals of CasLiver' },
```

BPMは各曲の実測BPMに対して+1.12高く設定してあり、これによりグリッドが音楽より先行し、30拍までに約+118msの「前方ドリフト」が蓄積する。これはプレイヤーの「音の直前に反応する」先読みタップ感覚に合わせた意図的なずらし。B/Cはさらに最初の検出拍から-30msシフトし全体を手前に寄せている。

BPM再計測・ドリフト検証は `tools/bpm_drift_check.py` 参照。

## TUNINGパラメータ

`game.js` 冒頭の `TUNING` オブジェクトで調整。ブラウザdevtoolsから `window.TUNING.beatLatencyMs = 180` のようにライブ変更可。

| キー | 現在値 | 役割 |
|------|------|------|
| `beatIntervalMs` | 560 | 拍間隔（グローバル。実際は曲ごとのBPMから再計算される）|
| `perfectWindowMs` | 75 | Perfect判定ウィンドウ（±ms）|
| `greatWindowMs` | 140 | Great判定ウィンドウ |
| `goodWindowMs` | 220 | Good判定ウィンドウ |
| `gainPerfect/Great/Good` | 3.85/2.31/1.31 | 各判定のゲージ増加量 |
| `decayPerSec` | 2.0 | 手を止めたときの毎秒減衰量（% / sec）|
| `targetTimeSec` | 18 | タイムボーナスの基準秒数 |
| `beatLatencyMs` | 80 | 全体の拍タイミング遅延補正 |
| `effectIntensity` | 10 | パーティクル量・演出強度 |
| `shakeEnabled` | true | 画面シェイクON/OFF |
| `flashEnabled` | true | 白フラッシュON/OFF |

## GIFステージ進行

ゲージの進捗に合わせてキャラGIFが段階的に切り替わる。

| stage | 役割 | ループ | 遷移契機 |
|-------|----|----|----|
| A | 0-19%（idle） | ○ | gauge≥19 で B に遷移 |
| B | bridge（耳ピク） | × | A終了で自動再生→Cへ |
| C | 19-60%（interest） | ○ | gauge≥60 で D に遷移 |
| D | bridge（前のめり） | × | C終了で自動再生→Eへ |
| E | 60-100%（excited） | ○ | クリアまでループ |
| F | クリア演出（kiss） | × | triggerClear で再生、4秒で次シーン |

ブリッジBはループGIF終了タイミングで差し替え、ちらつきなく進行。

## 演出の仕組み

- ボタン押下 `scale(0.92)` → `elastic.out` で弾性復元（GSAP）
- リップル波紋（CSS animation）
- 多色パーティクル散布（量は `effectIntensity` と判定レーティングで決定）
- コンボ数字ポップアップ（Perfect × 3+ / 10 COMBO / 毎5コンボ）
- 画面シェイク（レーティング別に2-4px）
- 白フラッシュ（80ms）
- ゲージのパルスリング
- 連打フェーズ専用のフルスクリーン「猛プッシュ」オーバーレイ

## シェア

クリア後、スコアとランクを付けてX / LINE / Threadsにシェア可能。
`buildShareText()` でテキスト生成、`#きょむうさ猛プッシュ #CasLive` ハッシュタグ固定。

## 技術

- Vanilla JS + GSAP 3.12（演出用のみ）
- Web Audio API — BGM再生位置を基準に拍点を算出、`bgmCurrentTime` * 1000 で ms換算
- 60fps目標、パーティクルは `requestAnimationFrame` 管理
- `touch-action: manipulation`、`touchstart` / `mousedown` 二重発火防止
- モバイルSafariの long-press コンテキストメニュー抑制
- GIFちらつき防止：`src` 再代入によるループリセット、全アセット `new Image()` プリロード
- アクセシビリティ：`prefers-reduced-motion` 対応
- スペースキーでデスクトップタップ可能（開発用）

## キャッシュ更新

`index.html` 内 `<script src="./game.js?v=N">` のバージョン番号を上げると、ブラウザに新JSを強制再取得させられる。game.js 更新時は合わせて bump。

## ローカル確認

```
# ローカルHTTPサーバーで開く（file://だと一部MCP/audio機能が動かない）
cd game
python -m http.server 8000
# → http://localhost:8000/
```
