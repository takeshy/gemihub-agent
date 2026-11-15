# 店舗の保存先・ログイン・親からの招待

## 保存先

設定、予約、顧客、問い合わせなどの正本はFirestoreのまま。画像、添付、仕様書、変更履歴、記事原稿、オフラインページ、デザインの版履歴は、非公開のCloud Storageへ保存する。店舗ごとのオブジェクトキーとFirestoreのファイル管理情報で所有権を確認し、別店舗のファイルIDを指定しても読めない。Cloud Storageはサーバーのサービスアカウントで利用し、店主のGoogle認証に依存しない。

公開ページ用の `STOREFRONT_BUCKET` を設定する。ファイル用バケットを分ける場合は、店舗アプリの `SHOP_FILES_BUCKET` に保存先を設定する。未指定なら既存の `STOREFRONT_BUCKET` を使う。サービスアカウントに対象バケットへのオブジェクトの作成・読み取り・更新・削除権限が必要。バケットを公開しない。ローカルデモはメモリ内の保存先を使う。

店主の「公開の設定」から、設定・記録とファイルの実体をZIPでダウンロードできる。`web/` はオフライン表示用のページ、`files/index.json` は保存ファイルの索引、`shop.json` は店舗データと記録。認証情報や他人の非公開チャットを含めない。従来のJSONとCSVも残す。ZIPはファイル単位で圧縮し、応答へ順に送る。

## 店舗のログイン

| 対象 | ログイン方法 |
| --- | --- |
| ネイル・美容室の店主 | Google。Gmail・Calendar連携を維持。Drive権限は求めない |
| 飲食店・その他の店主 | メールリンク。Googleアカウント不要 |
| 公開ページの閲覧・飲食店のゲスト予約 | ログイン不要 |
| 親の店舗招待・登録管理を行う運営者 | 許可したGoogleアカウント |
| 親でお店を探す一般利用者 | ログイン不要 |

店主用と顧客用のメール認証は、チャレンジの保存領域と認証種別を分離する。顧客用リンクは管理権限を付与しない。店主用リンクは15分間・1回限りで、URLのフラグメントに入れる。ページを開いただけでは消費せず、メールアドレスを表示して確認した時点でセッションを作る。送信回数をメールアドレスと送信元で制限し、送信失敗時はチャレンジを取り消す。

メールリンクでサロンにはログインできず、サロンへの変更・公開にはGoogleログインが必要。`ACCESS_PASSWORD` による招待制が有効な場合、新規メール登録も親からの招待を必要とする。

## Gmailと親の招待

ルートの `.env.example` を参照して次を設定する。既存のGeminiキーとは別の設定。

- `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`: Google OAuthクライアント。
- `PARENT_ADMIN_EMAILS`: 運営者のメールアドレスの許可リスト。カンマ区切り。
- `PARENT_AUTH_SECRET`: ランダムな32文字以上。Gmailのリフレッシュトークンを暗号化する鍵。
- `PARENT_ORIGIN`: 管理画面のURL。ローカルでは `http://localhost:8091`。
- `PARENT_INTEGRATION_SECRET`: ランダムな32文字以上の、親・店舗サーバー間だけで共有する秘密。
- `SHOP_ADMIN_ORIGIN`: 店舗アプリのURL。既定は `http://127.0.0.1:3000`。

`SHOP_ADMIN_ORIGIN` は店舗側の `APP_ORIGIN` と同じURLにする。親をlocalhost、店舗を127.0.0.1に分けると、親のログインCookieを店舗へ送らずに使える。管理画面を127.0.0.1から開いても、Google認証は設定済みの `PARENT_ORIGIN` へ移動して行う。

Google OAuthに `${PARENT_ORIGIN}/auth/google/callback` をリダイレクトURIとして登録し、Gmail APIを有効にする。親の管理画面で運営者がGoogleログインし、Gmail送信を許可する。「お店を招待する」で店主のメールアドレス、店名、種類を指定する。飲食店・その他はメールリンク、ネイル・美容室は招待先のGoogleアカウントで本人確認する。認証前は店舗情報の読み取り・変更・招待を拒否する。未設定の場合も管理APIを開放しない。

店舗側は `PARENT_MAIL_URL=${PARENT_ORIGIN}/api/internal/mail` と同じ `PARENT_INTEGRATION_SECRET` を設定する。招待・ログインリンク・店舗通知をGmailから送る。親の招待は招待した運営者のGmailを使い、通常の通知は `PARENT_MAIL_SENDER` または最後に接続した運営者のGmailを使う。保存したGmail接続はログアウト後の通知にも利用する。

親はGmailの接続情報を暗号化してgit対象外の `admin/auth.json` に保存する。セッションID・チャレンジはハッシュ化して保存し、ブラウザには認証情報を返さない。連携用APIは共有秘密によるサーバー認証を必須とし、一般利用者からは使えない。ログインしても既存の店舗取り込み結果が自動保存されることはない。

`npm run dev:demo` は親・管理・店舗をまとめて起動し、店舗のGmail中継先を設定する。実際のメール送信には上記のGoogle設定が必要。自動テストではOAuthとメール送信を置き換え、実メールは送らない。

## 親なしの店舗アプリ

店舗アプリは単独で起動・配備できる。親の設定は必須ではない。運営用Gmailの `PLATFORM_GMAIL_REFRESH_TOKEN` と `GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET` を設定すると、親を経由せずにログインリンクや通知を送る。店舗ごとの店主がGoogleログインする必要はない。メール送信元はサービス運営者が一度接続・管理する。

## 既存のDriveファイルの移行

旧形式の `shop.google` は移行元として残し、新しい保存先は `shop.storage` に記録する。既存のDriveファイルがある店は、移行前の保存・公開・ZIP書き出しを拒否する。空の保存先で既存ファイルを置き換えない。

旧Google接続の復号鍵とDrive読み取り権限を使える環境で、店舗ごとに次を実行する。

```sh
npm run migrate:storage --workspace @gemihub/shop -- <shop-id>
```

店舗の構成ロックを取り、元フォルダ以下のファイルをIDと階層を維持してCloud Storageへコピーする。全コピーの成功後に保存先を切り替える。途中の失敗は再実行できる。旧デザイン履歴もCloud Storage内のファイルから読める。元のDriveファイルは変更・削除しない。本番の切り替え前に移行を済ませる。

実装時のAPI参照: [Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)、[Gmail送信](https://developers.google.com/workspace/gmail/api/guides/sending)、[Cloud Storageオブジェクト作成](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/insert)。
