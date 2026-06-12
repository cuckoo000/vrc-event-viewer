# vrc-event-viewer

VRChatイベントカレンダーの今日/今週のイベントを一覧表示するWebビューアです。

- 公開ページ: https://cuckoo000.github.io/vrc-event-viewer/
- データソース: Googleカレンダー（GAS Webアプリ経由のJSON API、読み取り専用）

## 構成

| ファイル | 役割 |
|---|---|
| `index.html` | 単体ページ（コンテナdivとスクリプト読み込みのみ） |
| `widget.js` | 取得・描画ロジック本体 |
| `style.css` | スタイル（モバイルファースト） |
| `config.js` | API URL等の設定 |

## 開発について

このリポジトリは公開配信用です。ソースの正は別リポジトリ（private）の `web/` ディレクトリで管理しており、変更はそちらからコピーして反映します。Issue / Pull Request での変更は受け付けていません。
