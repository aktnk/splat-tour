# splat-tour

3D Gaussian Splatting（3DGS）空間を自由に移動しながら、任意の座標に入口アイコンを配置できるバーチャルツアー・ビューア。アイコンにマウスオーバーすると解説（テキスト・画像）を表示し、クリックすると別の3DGS・3Dモデル・Webページへ移動できる。

[try-spark](https://github.com/aktnk/try-spark) での実装経験をもとに、ゼロから再実装しているTauriデスクトップアプリケーションです。このアプリはツアーの制作ツールで、作成したツアーはWeb上で公開し、PC・スマートフォンのブラウザで体験できるようにする予定です。

## 技術スタック

- Tauri v2
- Vite + TypeScript
- Three.js
- [@sparkjsdev/spark](https://sparkjs.dev/)（3DGSレンダラー）
- nipplejs（タッチ操作用バーチャルジョイスティック）
- SQLite3（編集情報の保存）

## セットアップ

```bash
npm install
npm run tauri dev
```

## 仕様

機能の詳細は [docs/spec/specification.md](./docs/spec/specification.md) を参照。

## 読み込み検証（spike）

実データを Web 公開向けに変換し、PC・スマホでの表示性能を計測する手順は [spike/README.md](./spike/README.md) を参照。

## 実装状況

- [x] 3DGS読み込み（`.ply` / `.splat` / `.spz` / `.ksplat` / `.sog`）
- [x] 視点回転、WASD + マウスルック、タッチジョイスティック
- [ ] 矢印キー移動、PC向け疑似マウスパッド
- [ ] 歩行モード（壁・地面）/ ドローンモード
- [x] 3DGS設定UI: 露出、Focal Adjustment、軸フリップ、カメラ設定（速度・感度・FOV）
- [ ] 最初の表示位置・向き・大きさの指定と保存
- [x] アイコン配置・選択・再配置・WASD/QE微調整
- [ ] アイコンのホバー表示（テキスト＋画像）
- [ ] 入口の遷移先設定と遷移（3DGS / 3Dメッシュ / WebURL）、メッシュ・Web表示画面、「戻る」「終了」
- [ ] 3DGS間の遷移（入口ごとの到着位置・向き、遷移先の「出口」）
- [ ] 編集画面（左側メニュー）
- [ ] SQLite保存（プロジェクト単位）
- [ ] 静的バンドルの書き出し
- [ ] Webビューア（ブラウザ動作、Tauri API非依存）

## License

MIT License. See [LICENSE](./LICENSE) for details.
