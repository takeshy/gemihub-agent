# 店舗管理画面の実装・検証（2026-11-15）

対象: `specs/ADMIN_SPEC.md` v0.1。

## 実装

- `npm run admin` でループバック専用の管理サーバーを起動。`ADMIN_PORT` と `--production` に対応。
- URLからマニフェスト、名前が完全一致する予約ネットワーク、読み取り専用MCPの `get_shop_info` を解決。HTMLの発見リンク、ネットワークの選択、同一オリジンのリダイレクト、各通信10秒のタイムアウト、MCPセッションとSSE応答に対応。
- 追加・編集・再取得の選択反映・削除確認・並び替え・生成ファイルの一覧表示。MCP取得に失敗した場合は手入力で保存可能。
- `validateShops()` と既存ビルドを再利用。一時領域でビルドし、成功後に店舗データと生成物を反映。反映途中の失敗時も元のバイト列へ復元。保存処理を直列化し、古い一覧による更新は拒否。
- 表示用情報は `admin/cache.json` のみに保存。管理サーバーは許可した3つのUIファイルだけを配信し、キャッシュやサーバーのソースは配信しない。公開 `site/`、公式ランタイム、店舗側ソースには変更なし。

## 自動検証

`npm test`: 81件成功（既存52件と追加29件）。`npm run check` も成功。

追加テストはURL各種・HTMLの発見リンク・複数ネットワーク・マニフェスト/ネットワーク欠落・MCP失敗時のプレビュー・衝突・住所推定・リダイレクト・応答本文読み取りのタイムアウト・Host/Origin拒否・本番URL・ビルド失敗時の保全・反映途中の復元・並行削除・古い更新の拒否・キャッシュからのエラー解除を検証。

## ブラウザと実店舗デモの結合検証

店側を `DEMO_MODE=true SEED=restaurant-demo` でメモリ内に起動し、作業ファイルとは別の一時コピーで実行。

```sh
# gemihub-restaurant で起動（既存の3000番ポートを避けた検証用設定）
PORT=13001 APP_ORIGIN=http://127.0.0.1:13001 \
  DEMO_MODE=true SEED=restaurant-demo \
  AGENT_PARENT_URL=http://localhost:18090 \
  node --import tsx server/index.ts

# gemihub-agent で実行（既存のPlaywrightとChromiumを利用）
PLAYWRIGHT_MODULE=/home/takeshy/pkg/gemihub-restaurant/node_modules/playwright/index.mjs \
  CHROMIUM_PATH=/snap/bin/chromium \
  SHOP_ORIGIN=http://127.0.0.1:13001 npm run test:admin
```

- 炉端 灯・トラットリア ソーレ・広東 龍をそれぞれトップ、予約ページ、マニフェストURLから登録し、店名と推定エリアを照合。
- IDの編集不可、編集保存、再取得した項目の未選択時の保持と選択後の反映、上下の移動、削除のキャンセルと実行、再登録を確認。
- PC 1440px・スマートフォン390pxで表示を確認。ページ全体の横はみ出しなし。
- 生成した親サイトを起動し、チャットから3店の実ネットワークを読み込み、各店の実MCPへ `get_shop_info` を実行。問い合わせ確認前に店舗への通信がないことも確認。
- ブラウザのJavaScriptエラーなし。撮影結果はgit対象外の `test-results/admin-desktop.png`、`admin-mobile.png`、`admin-parent-inquiry.png`。

LLMの返答はテスト用に固定。有料モデルや実予約は呼んでいないため、実モデルの回答品質や本番配信の検証には含めない。

## 仕様の未決事項と既存制約

- Q1: 店側は変更せず、ジャンルは手入力、エリアは住所から推定。
- Q2: 並び順は店舗一覧と生成物へ反映。AIの問い合わせ順の保証はしない。
- Q3: 再取得時は変更項目を確認し、運営者が選択して反映。
- Q4: 本番用もローカル管理後に生成物をコミットして公開する運用を案内。デプロイは未実施。
- 既存 `validateShops()` の「1店以上」を保持。最後の1店の削除はエラーになり、ファイルは変わらない。
