# dev.gemihub.net

親・運営管理・店舗アプリを、東京の専用Compute Engine `gemihub-dev`（`e2-small`、メモリ2GB）で動かす。既存の `shared-apps` や本番DBには配備しない。

| URL | 用途 |
| --- | --- |
| https://dev.gemihub.net | お店さがし。一般利用者はログイン不要 |
| https://admin.dev.gemihub.net | 運営管理。許可したGoogleアカウントでログイン |
| https://shop.dev.gemihub.net | 店舗アプリ。メールリンク／サロンはGoogle |

## メモリと保存先

ビルドはCloud Buildで行い、2GBのVMでは実行しない。アプリ全体のメモリ上限は1536MiB、HTTPS用Caddyは96MiB。OSなどに約400MiBを残す。Nodeのヒープ上限は親配信48MiB・管理192MiB・店舗512MiBで、上記のコンテナ上限にはChromiumなどのメモリも含む。画面撮影は店舗サーバー内で直列化する。2GBのswapは一時的な余裕であり、常用を前提にしない。

少人数の開発・検証を想定した構成。多数の店舗が同時に画面生成を行う用途の容量を保証するものではない。稼働後にRSS・swap・OOMを確認し、必要なら4GBへ変更する。`e2-small` は2つの共有vCPU、継続利用できるCPU枠は合計0.5 vCPUなので、重い処理が続く場合はCPUも考慮する。[Google仕様](https://docs.cloud.google.com/compute/docs/general-purpose-machines#e2-shared-core)

- Firestore: `gemihub-dev`。本番とは別DBで、ランタイムのアクセス権もこのDBに限定。
- ファイル: `${project}-gemihub-dev-files`。非公開の専用Cloud Storage。
- 親の店舗一覧・接続キャッシュ・暗号化済みGmail接続: VMの永続ディスクの `/var/lib/gemihub-dev/parent/`。コンテナ更新後も残る。VMやディスクを作り直す場合はこのディレクトリの非公開バックアップが必要。
- TLS証明書: `/var/lib/gemihub-dev/caddy/`。
- 初期の親の登録店は0件。本番データやローカルのデモ店舗はコピーしない。
- 独自店舗ドメインの自動発行はこの環境では無効。店舗は `/s/<slug>/` で公開する。

## 初回の配備

プロジェクトは `geminihub-486523`、ゾーンは `asia-northeast1-b`。Terraform stateは既存の非公開state用バケットの `terraform/gemihub-dev` という独立したプレフィックスに保存する。元の店舗アプリ用Terraformとは別stateで、VM・ネットワーク・IP・3つのDNS Aレコード・専用サービスアカウント・DB・バケット・レジストリ・IAM・ログ用インデックスを作成する。

```sh
cp infra/dev/backend.hcl.example infra/dev/backend.hcl
# infra/dev/terraform.tfvars に一意なイメージタグと利用可能なモデル名を指定する。
# app_image = "asia-northeast1-docker.pkg.dev/geminihub-486523/gemihub-dev/app:<release-tag>"
# vertex_model = "<available-model>"
terraform -chdir=infra/dev init -backend-config=backend.hcl
terraform -chdir=infra/dev plan -out=dev.tfplan
terraform -chdir=infra/dev apply dev.tfplan
node infra/dev/configure-secrets.mjs geminihub-486523 <operator-email> /secure/path/dev-oauth-client.json
gcloud builds submit . --project=geminihub-486523 --region=asia-northeast1 \
  --config=infra/dev/cloudbuild.yaml \
  --service-account=projects/geminihub-486523/serviceAccounts/gemihub-dev-build@geminihub-486523.iam.gserviceaccount.com \
  --gcs-source-staging-dir=gs://geminihub-486523-gemihub-dev-build-source/source \
  --substitutions=_IMAGE=asia-northeast1-docker.pkg.dev/geminihub-486523/gemihub-dev/app:<release-tag>
```

ランタイムはイメージとSecret Managerの準備を再試行し、準備できるとサービスを起動する。Secret Managerの `gemihub-dev-runtime` にdev専用の暗号化鍵・連携用秘密・運営者・招待制のキー・提供したOAuthクライアントを保存する。設定スクリプトは既存の鍵を保持し、ルート `.env` のGeminiキーを読み、値を出力しない。本番のOAuthクライアントや暗号化鍵は変更しない。

Google OAuthの「承認済みのリダイレクト URI」に以下を追加する。

```text
https://admin.dev.gemihub.net/auth/google/callback
https://shop.dev.gemihub.net/auth/google/callback
```

新規店主は親から招待する。運営者が親でGmail送信を承認するまで、店舗のログインメール・通知は送れない。Google側でのURI登録と実際の承認はTerraformでは変更しない。

## 検証と更新

```sh
gcloud compute ssh gemihub-dev --project=geminihub-486523 --zone=asia-northeast1-b --tunnel-through-iap \
  --command='sudo systemctl status gemihub-dev --no-pager; sudo docker stats --no-stream; free -m'
```

3つのURLのHTTPS、未認証の管理API拒否、Googleログイン、招待メール、店主の再ログイン、保存とZIP出力を確認する。モデルやメールを使う実機検証はテスト用応答とは区別する。ランタイム設定や `docker inspect` の環境変数を出力しない。

更新は新しいタグでCloud Buildを完了してから `app_image` を更新し、Terraform plan/apply後にVMの `sudo google_metadata_script_runner startup` を実行する。Caddyfileも変更した場合は、続けて `sudo docker exec gemihub-dev_caddy_1 caddy reload --config /etc/caddy/Caddyfile` で経路を反映する。ランナーは新しいイメージを取得し、親の登録店を保持したまま配信ファイルを作り直す。戻すときは直前のイメージタグを指定する。初期配備や更新時の構成全体の自動ロールバックは行わない。

DNSやHTTPSの検証だけでは認証・メール・保存の動作確認にならない。Cloud Buildが成功しても、VM上の起動と公開URLの確認まで実施する。

保存先とChromiumの確認は、コンテナ内の `/app/apps/shop` から `node --max-old-space-size=256 --import tsx /app/infra/dev/smoke.mjs` で実行する。検証用プロセスには256MiBのヒープを指定する。既定の64MiBは監督プロセス用なので、検証スクリプトでは不足する。検証用のFirestore・Cloud Storageデータは終了時に削除する。

親の `site/shop-data.js`・`site/script.js`・`site/finder.js`・`site/shop-frame.js` だけを変更した場合は、`cloudbuild-finder.yaml` と `Dockerfile.finder` で差分イメージを作成できる。`_BASE_IMAGE` には現在稼働しているイメージの不変ダイジェスト、`_IMAGE` には新しいタグを指定する。この4ファイル以外の本番用コード・HTML・スタイル・依存関係を変更した場合は、通常の `cloudbuild.yaml` を使う。配備と登録店保持の手順は通常の更新と同じ。
