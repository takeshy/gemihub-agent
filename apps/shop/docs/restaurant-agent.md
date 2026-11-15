# 飲食店の予約エージェント（Open Agentic Web）

飲食店（業種「飲食店」）のお店は、席数で予約を受け付け、[Worldwide Agentic Web MVP Profile 0.2](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md) を参照したエージェントを公開します。店舗機能の当初仕様は `specs/old/restaurant-spec.md`、現在の親子連携仕様は `specs/parent-restaurant.md` にあります。規格への完全適合は未検証です。

## ローカルで試す

```shell
npm ci
npm run build
PORT=3000 DEMO_MODE=true SEED=restaurant-demo APP_ORIGIN=http://127.0.0.1:3000 AGENT_PARENT_URL=http://localhost:8090/ npm start
```

- 3 店（`akari`・`trattoria-sole`・`kanton-ryu`）が公開状態で用意されます。予約は「今夜」と「次の金曜（宴会の日）」に入ります。宴会の日を変えるには `SEED_BANQUET_DATE=2026-12-18` を付けます。
- 予約ページ: http://127.0.0.1:3000/s/akari/reserve
- オーナー画面: http://127.0.0.1:3000/ で「デモ」ログイン（店主のメールは `akari-owner@example.com`・`sole-owner@example.com`・`ryu-owner@example.com`）。
- `APP_ORIGIN` は開くアドレスと同じにします。ネットワーク定義に MCP のアドレスとして入るためです。親サイトを `localhost`、お店を `127.0.0.1` で開くと、ローカルでもキーの Cookie が相手に届きません。
- アシスタントは訪問者自身の LLM キー（BYOK）で動きます。ローカルでは支出上限の低いキーを使い、試した後は「Delete setup」で消してタブを閉じてください。
- 店舗ページの「AIに相談」でチャット専用画面を開きます。「元の画面に戻る」で元のページへ戻り、会話と入力は保持します。引き継いだ予約条件はチャット内に表示し、「反映」を押すと条件がユーザーメッセージとして投稿されます。直接訪問時のLLM設定は「AIの設定」のモーダルで行います。
- `/reserve` は店舗トップとは別の予約ページです。店舗と共通のヘッダー・テーマ・フッターで通常の予約フォームと「AIで予約する」を表示します。AIなしでも確認ダイアログを経て予約でき、ボタンを押した場合だけチャットを開きます。「元の画面に戻る」で入力中のフォームへ戻れます。店舗トップや記事の予約フォームは表示しません。

## 公開するもの

| パス | 内容 |
|---|---|
| `/s/<slug>/agent/agent-manifest.json` ほか | 公開バンドル（manifest・`reservation_concierge.network.json`・`links.json`・`agent-mcp.json`・`.well-known/nsdeploy*.json`）。`Access-Control-Allow-Origin: *` |
| `/s/<slug>/agent/bridge/` | 他サイトが隠しフレームで読むブリッジ。枠表示を禁止しません |
| `/s/<slug>/agent/runtime/` | 公式ランタイム（無改変） |
| `/s/<slug>/agent/mcp` | 読み取り専用 MCP（`check_availability`・`find_menu_items`・`get_shop_info`）。結果には確認時点（`checkedAt`）が入ります。認証なし、Cookie を読まない、1 分 60 回まで |
| `/s/<slug>/reserve` | 店舗と共通のデザインの予約ページ（通常フォームと任意のAI相談） |

ネットワーク URL は `https://<host>/s/<slug>/agent/reservation_concierge` です。他のエージェントサイトがこれを呼ぶと、そのサイトの訪問者のブラウザ内で、訪問者のキーで動きます。`website_*` ツールは渡らないので、空席とメニューの材料は MCP から答え、予約の確定は必ずこのお店のページで行います。

## お店さがしサイト（親サイト）との連携

`AGENT_PARENT_URL` に親サイトの URL（例 `http://localhost:8090/`）を設定すると、次が有効になります。仕様は `specs/parent-restaurant.md` です。

- **店舗ページの埋め込み**: 店舗トップ、予約ページ、記事・追加ページ、店舗ページを、登録した親オリジンだけが iframe 表示できます。APIと管理画面の埋め込みは禁止したままです。店舗トップ・記事・追加ページにも予約ページと同じAI相談機能を表示します。既存の `?pane=reserve` リンクも予約ページへ移動します。
- **埋め込み時の表示**: iframe の中では店舗自身のアシスタントが動きます。店舗の Service Worker が LLM 呼び出しだけを親へ中継し、親が自分の設定とキーでプロバイダーを呼びます。店舗には本物のキーを渡さず、公式ランタイムの起動オプションに中継先・セッション識別値・親で選んだモデルを渡します。子の「AIに相談」を押した時だけ中継と店舗チャットを開始し、親のAI設定を自動利用します。ON/OFFや追加の許可カードは表示しません。店舗側にはキー設定欄を表示しません。
- **確認と停止**: 予約は店舗側の確認ダイアログで承認した後に実行され、結果も店舗ページに出ます。親で「お店探しに戻る」を押すか店舗を切り替えると、実行中のLLM呼び出しを中断し、前のセッションの呼び出しを拒否します。通常フォームとAIチャットの両方から予約できます。
- **上限と障害**: 現在の親実装は1セッション40回・30分、1呼び出し120秒・本文512 KiBまでに制限します。店舗 Worker はヘッダー受信後も含め125秒で終了します。金額による上限は未実装です。LLM のエラー・中断は店舗に伝え、予約処理の通信断は結果不明として案内します。
- 未設定のときは、親サイトからの埋め込みを許可しません。店舗ページには親サイトへの誘導ボタンを表示しません。

飲食店の予約は会員登録・ログイン不要です。氏名と電話番号だけで予約でき（メールアドレスは受け取りません）、フォームとAIチャットの両方で同じ処理を使います。予約が入るとお店に通知メールが届き、お店がその電話番号へ折り返して確認します。人気店は「席の設定」で折り返しをやめられます。その場合、予約ページには「ご予約時刻から5分を過ぎてもご来店がない場合は、他のお客様をご案内します」と表示します。お客様へのメールは送りません。変更・キャンセルは店舗へ直接連絡します。店主の管理画面は引き続きログインが必要です。

最初のお店づくりチャットの機能選択で「予約あり」「予約なし」を選べます。番号でも言葉でも選択でき、ブログなどと組み合わせられます。選択はプラン作成・再試行・公開まで保持します。後から基本設定の「このサイトで予約を受け付ける」をオフにすると、店舗情報だけのサイトを公開できます。メニューや席設定がなくても公開でき、予約ページ・予約ボタン・予約AIは表示しません。既存の店舗は設定を変えない限り予約を受け付けます。

## しくみ

- `agentic/skill/` は公式スキル [`agentify-website`](https://github.com/cognizant-ai-labs/agentic-web/tree/main/skills/agentify-website) の無改変コピーです（コピー元: `cognizant-ai-labs/agentic-web` `63a956c`）。`runtime/` と `scripts/` は編集しません。
- `agentic/site/reservation_concierge.hocon` がネットワークの雛形です。`server/agentic.ts` が店名・MCP のアドレス・モデルを埋め、公式の `build_network.mjs` で店ごとにビルドします（結果は一時フォルダーにキャッシュ）。生成物は手で編集しません。
- 予約ページの操作は `agentic/site/reserve-page.js` にあり、アシスタントの `website_*`（`reservation-actions.js`）が呼び出します。予約ページではフォームと入力状態を共有し、店舗トップなどでは入力状態だけを内部で保持します。規則そのものはサーバー（`server/seats.ts`）にあります。
- 独自ドメインやサブドメインで公開しているお店では、同じものが `/reserve` と `/agent/` に出ます。ネットワーク定義の MCP アドレスもそのホストになります。
- MCP の回数制限は接続元アドレスとお店ごとに数えます。ロードバランサーの後ろでは `TRUSTED_PROXY_HOPS`（信頼するプロキシの段数）を設定しないと、全訪問者が同じ枠を共有します。
- 既定の LLM ルーターとモデルは `AGENT_LLM_ROUTER`・`AGENT_LLM_MODEL` で変えられます（既定は公式テンプレートと同じ hosted Otari と `alibaba/qwen3.8-flash`）。

## `website_*` ツール

| 名前 | effect | 内容 |
|---|---|---|
| `website_get_reservation_page_state` | read | 今日の日付、予約できる期間と人数、コース、フォームの現在値、`version` |
| `website_get_reservation_request` | read | 他サイトから URL フラグメント（`#aw=v1&date=…`）で引き継いだ条件。名前・連絡先・キーは含みません |
| `website_fill_reservation_form` | write | フォームに日付・時刻・人数・コース・食事の注記を入れる |
| `website_place_reservation` | irreversible | 予約を確定する。実行前にページの確認ダイアログが開きます |

## 確認コマンド

```shell
npm test                                   # tests/restaurant.test.ts, tests/reserve-page.test.ts を含む
node agentic/skill/scripts/check_partner.mjs http://127.0.0.1:3000/s/akari/agent/reservation_concierge
```

親の `gemihub-agent` も `npm start` で起動した状態で、プロバイダー応答を置き換える結合テストを実行できます（実際の LLM 課金なし、予約先はデモサーバー）。店舗側の `tests/llm-relay.test.ts` は通信元・セッション検証、中断、ヘッダー受信後のタイムアウトも確認します。

```shell
# モノレポのルートから実行（先に npm run dev:demo で両方を起動）:
npm run test:shop-frame
# Chromium の実体を指定する場合は CHROMIUM_PATH=/path/to/chrome を追加
```

結合テストは Chromium の PC 幅と390px幅で確認しています。実プロバイダー接続、Safari/Firefox、実機スマートフォン、本番の第三者 Cookie 制約は別途確認が必要です。

## 制限

- `write` のツール（フォームへの入力）は確認なしで実行されます（公式ランタイムの既知の差。規格 §3.1 は書き込み前の提示を求めています）。取り消せない操作は予約の確定だけで、これは確認ダイアログを通ります。
- 席は合計数で管理し、テーブルは割り当てません。
- オンライン決済・電話受付・カレンダー連携は飲食店では使いません。
- ネットワーク定義（指示文を含む）は公開物です。
