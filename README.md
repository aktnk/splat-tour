# splat-tour

3D Gaussian Splatting（3DGS）空間を自由に移動しながら、任意の座標にアイコンを配置して情報（解説・写真）を表示できるバーチャルツアー・ビューア。

[try-spark](https://github.com/aktnk/try-spark) での実装経験をもとに、ゼロから再実装しているTauriデスクトップアプリケーションです。

## 技術スタック

- Tauri v2
- Vite + TypeScript
- Three.js
- [@sparkjsdev/spark](https://sparkjs.dev/)（3DGSレンダラー）
- nipplejs（タッチ操作用バーチャルジョイスティック）

## セットアップ

```bash
npm install
npm run tauri dev
```

## 実装済み機能

- `.ply` / `.splat` / `.spz` / `.ksplat` / `.sog` 形式の3DGSファイル読み込み（ネイティブファイルダイアログ）
- FPSスタイルのカメラ操作（WASD + マウスルック）、タッチジョイスティック対応
- Lock-onモード（Space / L / F キーでトグル、原点注視 + 距離連動の速度スケーリング）
- HUD（center dot / crosshair）の表示切り替え
- Camera Settings: 移動速度、マウス感度、FOV（画角）
- Render Settings: 露出（スプラットの明るさ）、Focal Adjustment（スプラットのシャープネス）
- モデルのX / Y / Z軸フリップ（読み込んだ3DGSモデルの上下逆転などを補正）
- Reset View（カメラ位置・向き・フリップ状態を初期状態に戻す）

## 開発ステータス

現在、実装ロードマップの「ステップ1: 土台構築」まで完了。次はアイコン配置によるアノテーション機能（AnnotationStore）に着手予定。

## License

MIT License. See [LICENSE](./LICENSE) for details.
