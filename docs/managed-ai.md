# 運営のGeminiとBYOK

標準の公開チャットは、運営側の `GEMINI_API_KEY` を使う。親のお店さがしと店舗の公開アシスタントは、初回にキーを入力せず使える。標準モデルは `gemini-4-hydrogen`、推論は `low`。店舗の管理・問い合わせ・画面作成で使うGoogleの生成処理も、Geminiキーがあればそちらを優先する。画像生成は専用の画像モデルを使う。

「AIの設定」→「AIの利用方法」で「自分のAPIキー（BYOK）」へ切り替えられる。「運営のGemini（標準）」を選ぶと戻せる。変更はそのサイトを開いているブラウザに保存する。切り替えると会話を始め直す。BYOKのキーは従来どおりブラウザから選択したプロバイダーへ直接送り、運営のサーバーには送らない。

## 設定

```dotenv
GEMINI_API_KEY=
GEMINI_MODEL=gemini-4-hydrogen
GEMINI_THINKING_LEVEL=low
PUBLIC_AI_MODE=managed
PUBLIC_AI_DAILY_LIMIT=1000
PUBLIC_AI_IP_DAILY_LIMIT=100
```

`GEMINI_THINKING_LEVEL` は `low`・`medium`・`high` を選べる。`GEMINI_PUBLIC_MODEL` を設定すると公開チャットだけ別のモデルにできる。問い合わせ・店舗紹介はlowを標準とし、複雑な作業の品質がmediumと同じであるとは保証しない。

`PUBLIC_AI_MODE=byok` で運営キーによる公開チャットを停止し、BYOKだけに戻せる。店舗管理のGoogle生成は別で、`GOOGLE_AI_AUTH=vertex` を指定すると従来のADC/Vertex経路を使える。キーがない場合も従来のVertex設定を維持する。モデル名・認証情報は利用者のリクエストで上書きさせない。

ローカルの親はルートの `.env` を設定して `npm start`、親・管理・店舗の同時起動は `npm run dev:demo`。店舗を単独起動する場合は `apps/shop/.env` に設定する。静的配信だけのホストにはキーを置けないため、管理APIがない環境はBYOKを使う。

## 公開APIと保存

ブラウザは同じオリジンの `/api/ai/config` から利用方法を読み、`POST /api/ai/session` で短期の接続トークンを取得する。ブラウザへ渡すのはこのトークンで、Geminiキーではない。CookieはHttpOnly・SameSite=Strict、HTTPSではSecureにする。POSTは許可したサイトのOriginを確認する。推論先はGoogleのOpenAI互換APIに固定し、リクエストはサーバーのモデル・推論設定・出力上限で処理する。

運営キーの経路は、同時実行2件・1日全体1000リクエスト・IPごと100リクエスト・セッションごと1時間120リクエストを上限とする。会話中のツール呼び出しによる追加のモデル推論も1件として数える。1回の本文は512KiB、応答は4MiB、出力は最大4096トークン、通信は120秒で制限する。上限やプロバイダーエラーで別のAI・キーへ自動的に切り替えない。

本番の利用回数と、Geminiのツール呼び出しに必要な不透明な署名は、同じFirestore DBの `gemihub_public_ai` コレクションへ保存する。IPは日付・サービスの秘密とともにハッシュ化する。チャット本文・キー・ツールの引数はこの保存先には残さない。署名は7日で期限切れとなり、`expiresAt` のFirestore TTLでも削除する。ローカルの親単独起動とデモはメモリ内の状態を使い、再起動で消える。

GoogleがOpenAI互換ストリームでツールのindexを省略する場合は、運営側で補い、既存のブラウザ実行環境で複数ツールが混ざらないようにする。思考署名もサーバーで保持・再付与し、既存の固定ランタイムは変更しない。

devはCaddyで親の `/api/ai/*` を店舗サーバーへ接続する。店舗側は `AGENT_PARENT_URL` のOriginを明示的に許可する。キーを任意の問い合わせ先や店舗へ中継しない。`PUBLIC_AI_TRUST_PROXY=true` は、信頼するプロキシが転送ヘッダーを設定し、アプリへ直接アクセスできない構成だけで使う。

## 検証

`npm test` でOrigin・署名・利用上限・固定した推論先・キーの非公開・Geminiのツール署名と複数呼び出しを確認する。`npm run test:managed-ai` はテスト用応答で、親と店舗それぞれのPC・スマホ画面で標準→BYOK→標準の切り替えを確認する。実APIでの店舗紹介は別に検証し、メールや予約を送らない。

API参照: [OpenAI互換API](https://aistudio.google.com/docs/openai)、[Gemini 4 Hydrogen](https://aistudio.google.com/docs/models/gemini-4-hydrogen)。
