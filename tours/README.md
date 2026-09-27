# ツアーデータ（Webビューア用）

Webビューア（`viewer/`）で公開するツアーを置くフォルダです。1ツアー = 1フォルダで、`manifest.json`（ツアーの定義）と `assets/`（3DGS・3Dモデル・画像）から成ります。

`manifest.json` と `assets/` は git に登録されません（`.gitignore`）。実在の施設名や、公開の承諾前の座標などをうっかりコミットしないためです。リポジトリには、ひな形の `manifest_sample.json` だけを入れています。

```
tours/sample/
  manifest_sample.json  ← git に入る（ひな形）
  manifest.json         ← git に入らない（ひな形をコピーして作る）
  assets/               ← git に入らない（大きなファイル）
    main-hall-sh1-lod.rad
    doki-opt.glb
```

制作ツール（Tauri）で manifest を書き出せるようになるまでは、manifest を手で書きます。座標の調べ方は「座標の調べ方（デバッグ表示）」を参照してください。

## 手元で動かす

1. ひな形をコピーして `manifest.json` を作ります（初回だけ）。

   ```bash
   cp tours/sample/manifest_sample.json tours/sample/manifest.json
   ```

   以降は `manifest.json` を編集します。ひな形の書き方を変えたいとき（新しい項目の例を足すなど）だけ、`manifest_sample.json` を編集してコミットします。その際、実在の名称や実際の座標は書かないでください。

2. アセットを置きます。spike で変換したファイルをコピーします。

   ```bash
   cp spike/assets/main-hall-sh1-lod.rad spike/assets/doki-opt.glb tours/sample/assets/
   ```

3. 起動します。

   ```bash
   npm run viewer:dev
   ```

   - PC: http://localhost:5190
   - スマホ: 同じ Wi-Fi で `http://<PCのIP>:5190`（ターミナルに表示される Network の URL）
   - 別のツアーを開くとき: `TOUR_DIR=tours/<名前> npm run viewer:dev`
   - 特定のシーンから開くとき: `?scene=<シーンのid>`（例: `?debug=1&scene=main-hall`）。「終了」は `startSceneId` に戻ります

## シーンを追加する（例: 建物周辺 → 展示場メイン）

1. 3DGS を変換してアセットに置きます（ツアーに使うのは RAD SH1 だけです）。PLY の代わりに SOG（`exterior.sog` など）も指定できます。

   ```bash
   npm run spike:convert -- "/path/to/exterior.ply" --name exterior --sh 1 --rad-encoding gsplat --skip-spz
   cp spike/assets/exterior-sh1-lod.rad tours/sample/assets/
   ```

2. manifest にシーンを足し、行き来する入口・出口を両方のシーンに置きます。ひな形（`manifest_sample.json`）には、建物周辺（`exterior`）から展示場メインへの入口「建物に入る」と、展示場メインから外へ戻る出口「外に出る」が入っています。座標は仮の値です。
3. `?debug=1` で座標を調べて、仮の値を置き換えます。

   | 調べるもの | 開くシーン | やること |
   |---|---|---|
   | 建物周辺の `transform` | `?debug=1&scene=exterior` | 床合わせ |
   | 建物周辺の `initialView` | 同上 | ツアーを始めたい場所に立ち、「現在の視点」をコピー |
   | 入口「建物に入る」の `position` | 同上 | 建物の入口（扉）をクリック |
   | 外に出たときの `arrival` | 同上 | 入口の前に立ち、建物から離れる向きを向いて「現在の視点」をコピー |
   | 中に入ったときの `arrival` | `?debug=1&scene=main-hall` | 展示場の入口の内側に立ち、中を向いて「現在の視点」をコピー |
   | 出口「外に出る」の `position` | 同上 | 展示場の出入口をクリック |

   屋外は屋内より広いので、`camera.moveSpeed` を大きめ（サンプルでは 2）にしています。

## 大きな3DGSを軽くする（切り取り）

ストリーミングでも、見回しているうちにファイルのほぼ全体を読み込みます（建物周辺 169MB の実測では、30秒で 135MB）。スマホの通信量を抑えるには、データ自体を小さくするしかありません。屋外では、遠景や空に浮いたノイズを切り取るのが最も効果的です。

1. 切り取る前のデータを `?debug=1&scene=exterior` で開き、残したい範囲の中心（建物の中央付近の地面など）をクリックして座標を控えます。
2. 残したい半径（メートル）を決めて変換します。名前を変えておくと、切り取り前と比べられます。

   ```bash
   npm run spike:convert -- "/path/to/exterior.sog" --name exterior-crop --sh 1 --rad-encoding gsplat --skip-spz --crop-sphere 1.2,-0.5,3.4,30
   ```

   直方体で切り取るときは `--crop-box x1,y1,z1,x2,y2,z2`（対角の2点）を使います。
3. `spike/assets/variants.json` でサイズを確認し、`spike:dev` で見た目を確認します。問題なければ `tours/sample/assets/` にコピーし、manifest の `splat.url` を切り取った版に変えます。

座標は切り取っても変わらないので、調べた入口の位置などはそのまま使えます。

## 操作

| 操作 | PC | スマホ |
|---|---|---|
| 移動 | WASD / 矢印キー（Q/E で上下） | 左下のジョイスティック |
| 見回す（向きを変える） | ドラッグ | 1本指でドラッグ |
| 平行移動 | — | 2本指を同じ方向に動かす |
| 前後移動 | ホイール | 2本指でピンチ |
| 入口の説明 | アイコンにマウスを乗せる | アイコンを1回タップ |
| 入口を開く | アイコンをクリック | もう1回タップ、または「開く」 |
| 3Dモデル画面 | ドラッグで回転、ホイールで拡大 | 1本指で回転、2本指で拡大 |
| 戻る | 「戻る」ボタン / Esc | 「戻る」ボタン |
| 迷ったとき | 右下の「⟲ 初期位置」 | 右下の「⟲ 初期位置」 |

アイコンの色: 青「→」= 入口、橙「←」= 出口、緑「3D」= 3Dモデル、紫「Web」= Webページ。
アイコンは厚みのあるコイン型で、手前に壁などがあると隠れます（隠れているアイコンは反応しません）。

## スマホの発熱対策（ビューアの標準動作）

- 視点が止まって約1.5秒たつと描画を止め、ページの処理も止めます（次に触れるまで待機）。移動・見回し・読み込み中だけ描画します。
- フレームレートの上限: スマホ 30fps、PC 60fps。
- 解像度の上限: スマホ 1.5倍、PC 2倍。

## manifest.json の書き方

```jsonc
{
  "version": 1,
  "title": "ツアー名",
  "assetBaseUrl": "./assets/",        // アセットの置き場所。manifest からの相対パス、または https://… の URL
  "startSceneId": "main-hall",        // 最初に表示するシーン（「終了」で戻る先）
  "scenes": [
    {
      "id": "main-hall",              // シーンの識別子（英数字）
      "title": "展示場メイン",
      "splat": { "url": "main-hall-sh1-lod.rad" },   // .rad は自動でストリーミング表示
      "transform": { "rotation": [0, 0, 0], "flipX": false, "flipY": false, "flipZ": false, "scale": 1 },  // 省略可
      "render": { "exposure": 1, "focalAdjustment": 1 },                             // 省略可
      "camera": { "moveSpeed": 1, "fov": 60 },                                       // 省略可
      "initialView": { "position": [0, 0, 0], "yaw": 0, "pitch": 0 },               // 省略可
      "bounds": { "min": [-5, -1, -8], "max": [5, 3, 8] },                          // 省略可。移動できる範囲
      "entrances": [
        {
          "id": "doki",
          "kind": "entrance",         // "entrance"（入口）または "exit"（出口）。アイコンが変わるだけ
          "title": "土器",
          "description": "説明文（省略可）",
          "image": "doki.jpg",        // 説明に出す画像（省略可、assetBaseUrl からの相対パス）
          "position": [0, 0, -2],
          "target": { "type": "mesh", "url": "doki-opt.glb" }
        }
      ]
    }
  ]
}
```

入口の遷移先（`target`）は3種類です。

| type | 書き方 | 動作 |
|---|---|---|
| `scene` | `{ "type": "scene", "sceneId": "sub-hall", "arrival": { "position": [x, y, z], "yaw": 0, "pitch": 0 } }` | 別の3DGSに移動し、`arrival` の位置・向きから表示 |
| `mesh` | `{ "type": "mesh", "url": "doki-opt.glb", "exposure": 1 }` | 3Dモデル画面（「戻る」「終了」付き）。`exposure` は明るさ（省略時 1、暗ければ 1.5 など） |
| `url` | `{ "type": "url", "url": "https://…" }` | Webページ画面（「戻る」「終了」「新しいタブで開く」付き） |

- 3DGS 間の移動に「戻る」ボタンはありません。戻り道は、遷移先のシーンに「出口」（`kind: "exit"`）を置いて作ります。
- Webページは、埋め込みを拒否しているサイトだと真っ白になります。その場合は「新しいタブで開く」で開いてください。
- manifest に誤りがあると、画面に場所（例: `scenes[0].entrances[1].target.type`）付きのエラーが出ます。

### 座標と向き

- `position` は**そのシーンの3DGSファイル内の座標**です。`transform`（反転・拡大）を変えても、入口の位置がずれません。
- `yaw` / `pitch` は向きです（度）。`yaw` 0 で -Z 方向を向き、正の値で左を向きます。`pitch` は正の値で上を向きます。
- `transform.rotation` は3DGSの回転（度、X→Y→Z の順）です。`flipX` などはその軸の角度に180度を足します。3DGSが上下逆さまのときは、まず `flipX: true` を試してください。
- **3DGSが傾いていると、見回したときに景色が転がるように回ります。** 下の「床合わせ」で水平にしてください。

### 移動できる範囲（bounds）

`bounds` を指定すると、カメラはその直方体の外に出られなくなります。撮影範囲の外にある点のノイズに迷い込むのを防ぎます。座標はシーン内の座標（`position` と同じ）で、対角の2点を `min` / `max` に書きます（順番は逆でも構いません）。`?debug=1` の「現在の視点」の `position` を見ながら、範囲の端まで歩いて調べるのが簡単です。

壁や床の当たり判定ではないので、範囲の中では壁を通り抜けられます（壁・床の判定は、今後の歩行モードで対応します）。迷ったときは、右下の「⟲ 初期位置」でそのシーンに入ったときの位置に戻れます。

## 座標の調べ方（デバッグ表示）

URL に `?debug=1` を付けると、右上に次の情報が出ます。

- **現在の視点**: 今のカメラ位置と向き。`initialView` や `arrival` にそのまま貼れます。
- **クリックした位置**: 3DGS をクリック（タップ）した点の座標。入口の `position` に貼れます。

手順: 入口を置きたい場所をクリック → 表示された座標を manifest に貼る → ブラウザを再読み込み。

### 床合わせ（傾いた3DGSを水平にする）

1. `?debug=1` で開き、「床合わせ（床を3点クリック）」を押します。
2. 床の上の、なるべく離れた3点を順にクリック（タップ）します。
3. その場で水平になり、`"transform": {...}` が表示されます。manifest のそのシーンの `transform` と置き換えて、再読み込みしてください。

入口の `position` はシーン内の座標なので、床合わせをしても位置はずれません。`initialView` と `arrival` の `yaw` / `pitch` は、水平にした後に調べ直してください。

## 公開する

**公開の前に、撮影した施設の承諾を得てください。** 仲間内だけのつもりでも、URL を知っている人なら誰でも見られ、データのダウンロードもできます。

### 1. 公開用に変換する（RAD を分割）

Cloudflare Pages は 1ファイル 25MiB までなので、3DGS は `--rad-chunked` を付けて変換し直し、小さなファイルに分けます。

```bash
npm run spike:convert -- "/path/to/main-hall.ply" --name main-hall --sh 1 --rad-encoding gsplat --skip-spz --rad-chunked
cp spike/assets/main-hall-sh1-lod.rad spike/assets/main-hall-sh1-lod-*.radc tours/sample/assets/
```

ファイル名（`main-hall-sh1-lod.rad`）は分割前と同じなので、manifest はそのままで構いません。

### 2. 公開用フォルダを作る

```bash
npm run tour:bundle
```

`dist-publish/` に、ビューア・`manifest.json`・manifest が参照するアセットだけが集められます（使っていない変換結果は含まれません）。

- `--tour tours/<名前>`：別のツアー（既定は `tours/sample`）
- 検索エンジンに載らない設定（`robots.txt` と `_headers`）が既定で入ります。一般公開するときは `--allow-indexing` を付けます。
- 25MiB を超えるファイルがあると警告が出ます。
- 大きなアセットだけ別のストレージ（例: Cloudflare R2）に置く場合は `--asset-base-url https://…/` を付けます。アセットはフォルダに入らず、置くべきファイルの一覧が表示されます（ストレージ側で CORS と Range リクエストの許可が必要です）。

公開前に手元で確認するには、`dist-publish` を静的サーバーで開きます（例: `npx serve dist-publish`）。

### 3. Cloudflare Pages に置く

- **画面から**：Cloudflare のダッシュボード → Workers & Pages → Create → Pages →「Upload assets」で、`dist-publish` フォルダをアップロードします。
- **コマンドから**：`npx wrangler login` の後、`npx wrangler pages deploy dist-publish --project-name <プロジェクト名>`。

公開 URL は `https://<プロジェクト名>.pages.dev` になります。**プロジェクト名は URL に出るので、施設名などを入れないでください。**

- 無料プランで利用できます（Pages は転送量の課金なし。料金や上限は変わることがあるので、登録前に公式ページで確認してください）。
- 見られる人を限定したい場合は、Cloudflare Access（メールアドレスでログインした人だけが見られる仕組み）を Pages に設定できます。
