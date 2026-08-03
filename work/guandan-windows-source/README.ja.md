# Guandan Master

**言語**

- 日本語（現在）: `README.ja.md`
- 简体中文: [README.md](./README.md)
- English: [README.en.md](./README.en.md)
- Русский: [README.ru.md](./README.ru.md)
- 한국어: [README.ko.md](./README.ko.md)

Guandan Master は、ローカル対戦を中心に LAN マルチプレイにも対応した掼蛋（Guandan）プロジェクトです。

## 主な特徴

- 配札、出牌、パス、主導権リセット、精算、レベル進行、進貢/還貢までの一連フローを実装。
- A レベルの挑戦ルール（成功/失敗、連続失敗時の降級）に対応。
- `easy / medium / hard / master` の 4 段階 AI。
- Electron によるデスクトップ（Windows）ビルド対応。

## ゲーム概要

- 4 人 2 チーム（味方は向かい席）。
- 基本は同タイプでより強い組み合わせを出して競います。
- 他 3 人がパスすると、最後に有効牌を出したプレイヤーが次の先手。
- 最終目標は `A` 到達後に A 関門を突破することです。

## AI 戦略

- `easy`: ルール準拠の基本プレイ。
- `medium`: 味方連携と低価値な爆弾の回避。
- `hard`: 1〜2 手先の読みを使った戦術判断。
- `master`: 終盤重視の探索と相手モデルの活用。

## クイックスタート

```bash
npm install
npm run dev
```

LAN サーバー（任意）:

```bash
node server/index.js
```

## ライセンス

このプロジェクトは [Apache-2.0](./LICENSE) ライセンスです。
