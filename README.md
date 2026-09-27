# splat-tour

3D Gaussian Splatting（3DGS）で撮影した空間を、ブラウザ（PC・スマートフォン）で歩き回れるバーチャルツアーのWebビューアです。空間内に置いた入口アイコンにマウスを乗せる（スマホではタップする）と解説（テキスト・画像）が表示され、開くと別の3DGS・3Dモデル・Webページへ移動できます。

ツアーの内容は `manifest.json`（JSON）に書きます。このリポジトリには、ビューアのほか、manifest を手で書くための補助（座標の表示・床合わせ）、3DGS や 3Dモデルの変換、公開用フォルダの作成の道具が入っています。GUI で manifest を作る制作ツールは、別のプロジェクトで開発しています。

[try-spark](https://github.com/aktnk/try-spark) での実装経験をもとに、ゼロから再実装しています。

## 技術スタック

- Vite + TypeScript
- Three.js
- [@sparkjsdev/spark](https://sparkjs.dev/)（3DGSレンダラー）
- nipplejs（タッチ操作用バーチャルジョイスティック）

## セットアップと起動

```bash
npm install
cp tours/sample/manifest_sample.json tours/sample/manifest.json   # 初回だけ（manifest.json は git に入らない）
npm run dev             # http://localhost:5190（tours/sample を表示。?debug=1 で座標表示）
npm run build           # 型チェックと dist-viewer/ への公開用ビルド
npm run tour:bundle     # ビューア + manifest + 使っているアセットを dist-publish/ にまとめる
```

manifest の書き方、座標の調べ方、アセットの変換、公開方法は [tours/README.md](./tours/README.md) を参照してください。

## 他のプロジェクトから使う

ビューアの部品と manifest の型・検証は、パッケージとして読み込めます（TypeScript のソースのまま提供しているので、Vite などのバンドラーで使ってください）。

```ts
import { startTour, setupScene } from "splat-tour";
import { parseManifest, type Manifest } from "splat-tour/manifest";
```

## 仕様

機能の詳細は [docs/spec/specification.md](./docs/spec/specification.md) を参照。

## 読み込み検証（spike）

実データを Web 公開向けに変換し、PC・スマホでの表示性能を計測する手順は [spike/README.md](./spike/README.md) を参照。

## 実装状況

- [x] 3DGS の表示（LoD ストリーミングの `.rad` のほか `.ply` / `.spz` / `.splat` / `.ksplat` / `.sog`）
- [x] 視点回転、WASD / 矢印キー + マウスルック、タッチジョイスティック（画面回転に対応）
- [ ] PC向け疑似マウスパッド
- [ ] 歩行モード（壁・地面）/ ドローンモード
- [x] シーンごとの設定：回転補正（床合わせ）、大きさ、露出、Focal Adjustment、移動速度、FOV、最初の表示位置・向き、移動できる範囲
- [x] 入口アイコン（コイン型、壁で隠れる）とホバー表示（テキスト＋画像）。スマホはタップ
- [x] 入口の遷移（3DGS / 3Dメッシュ / WebURL）、メッシュ・Web表示画面、「戻る」「終了」「初期位置」
- [x] 3DGS間の遷移（入口ごとの到着位置・向き、遷移先の「出口」）
- [x] スマホの発熱対策（静止時は描画・処理を停止、30fps・解像度 1.5 倍上限）
- [x] manifest の手書き補助（`?debug=1` の座標表示・床合わせ、`?scene=` で任意のシーンから開く）
- [x] 公開データ形式の決定（3DGS: RAD SH1 ストリーミング、3Dモデル: 最適化 GLB）と変換ツール
- [x] 公開用フォルダの作成（Cloudflare Pages 向け、RAD の分割）

## License

MIT License. See [LICENSE](./LICENSE) for details.
