# モノレポの構成

お店さがしと店舗アプリを同じリポジトリで編集・検証する。親サイトの既存パスと公開フォルダは維持する。

店舗アプリは飲食店・サロン・雑貨店などを扱うため、共通の名前を `shop` に揃えた。ワークスペースは `@gemihub/shop`、編集先は `apps/shop/`、ルートの個別コマンドは `build:shop`・`test:shop`・`check:shop`・`start:shop`・`dev:shop`。飲食店の業種を表す `restaurant` は引き続き使う。

| パス | 用途 |
| --- | --- |
| `site/`, `src/`, `admin/` | 親サイトとローカル店舗管理 |
| `apps/shop/` | 店舗サイト・予約・運営管理・店舗エージェント |
| `vendor/agentify-website/` | 親サイトが使う公式ランタイム |
| `package.json`, `package-lock.json` | npm workspacesと全アプリの依存関係 |
| `.github/workflows/check.yml` | 親サイトと店舗アプリの独立した検証ジョブ |

## 開発

Node.js 24以上でルートから `npm ci`、`npm run build`、`npm test` を実行する。各アプリの依存関係はルートにインストールされ、店舗アプリのコマンドはnpmが `apps/shop/` を作業ディレクトリとして実行する。既存の相対ファイル参照を維持し、静的店舗ページとオフライン出力も同じ場所に生成する。

`npm run dev:demo` は親8090・管理8091・店舗3000を起動する。`FINDER_PORT`・`ADMIN_PORT`・`SHOP_PORT` で変更できる。どれかが終了した場合も残りを終了し、Ctrl+Cでも全プロセスを停止する。店舗は `DEMO_MODE=true SEED=restaurant-demo` のメモリ内データを使う。Googleや実店舗のデータは使わない。

個別起動は `npm start`、`npm run admin`、`npm run start:shop`。店舗の設定は `apps/shop/.env`、親のジャンル分類用キーはルートの `.env` を使う。既存の設定ファイルは自動コピーしない。

## 配信とコンテナ

親サイトは従来どおり `site/` だけを静的配信する。管理サーバーと店舗アプリは含めない。親だけを生成する本番用コマンドは `npm run build:finder -- --production`。

店舗コンテナはモノレポのルートをコンテキストにして作る。

```sh
docker build -f apps/shop/Dockerfile -t gemihub-shop .
# Cloud Buildもルートから実行する。デプロイを行わないビルド確認例:
gcloud builds submit --config apps/shop/cloudbuild.yaml --substitutions _DEPLOY=false
```

Dockerfileはルートのロックファイルと店舗コードを使い、コンテナ内の作業ディレクトリを `/app/apps/shop` にする。Cloud Build設定のDockerfileとVM配備スクリプトのパスもモノレポに合わせる。`.dockerignore`・`.gcloudignore` は設定ファイル、ローカルデータ、キャッシュを除外する。既存のCloud Buildトリガーや本番環境はこの移行では変更しない。

## 取り込み元（2026-11-15）

- リポジトリ: `https://github.com/takeshy/gemihub-restaurant.git`
- コミット: `26bcdb501b200cfad99121b75c3038a146bd64ce`
- コミット名: `Allow guest restaurant bookings and optional reservations at onboarding`
- 取り込み時の作業ツリー: 変更なし

このコミットのGit管理対象だけを `apps/shop/` に取り込んだ。`.env`・依存パッケージ・ビルド済みファイル・ローカルデータは取り込まない。ライセンスと第三者表記を保持する。元のリポジトリとGit履歴はそのまま残し、このリポジトリの履歴への合流や元ディレクトリの削除は行わない。以降のアプリ変更はこのモノレポで行う。

## 追加取り込み（2026-11-16）

旧リポジトリで取り込み後に作成された `281adb87d808b9040f8b0c9414b37bd9ac146e6a`（`Take guest restaurant bookings by phone only and harden the onboarding interview`）の差分を追加反映した。予約の電話番号必須化・店舗だけへの通知・確認電話の設定・予約件数制限・初期ヒアリングの判定修正を含む。

取り込み時点のCloud Storage・店主メールログイン・親のGoogle認証とGmail招待の変更を維持し、翻訳は両方の追加分を統合した。旧リポジトリは変更していない。今後の店舗側の編集先は、このリポジトリの `apps/shop/`。
