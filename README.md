# gemihub-agent

飲食店予約の親サイト。条件を整理し、登録店の公開エージェントネットワークに空席・メニュー・材料を確認し、回答を比較して店の予約ページへ案内します。席のみの通常予約と、コースを選ぶ宴会を同じ流れで扱います。予約の確定・変更・キャンセル・決済は店側で行います。

仕様: [specs/restaurant-spec.md](specs/restaurant-spec.md) v0.3。現行実装との差分は [仕様見直しメモ](docs/spec-review-2026-11-14.md) を参照してください。

## 起動

Node.js 22以上（店側と合わせる場合は24以上）。アプリ・ビルド・Nodeテストに追加パッケージは不要です。

```sh
npm run build
npm test
npm start
```

ブラウザで **http://localhost:8090/** を開きます。`file://` では使えません。

1. 未設定の場合は最初に「AIを設定して始める」モーダルが開きます。プロバイダーをプルダウンで選び、自分のAPIキーを入力して **保存して始める**。Otariを選ぶと、OtariのURLと`alibaba/qwen3.8-flash`が自動入力されます。設定済みならモーダルを省略し、ページの **AIの設定** から変更できます。既定は OpenRouter / `openai/gpt-6-luna`（GPT-6 Luna）。保存済み設定のモデル指定はサイトの既定より優先されるため、以前のモデルを保存済みなら詳細設定のModel欄も変更してください。キーの保存は公式ランタイムが管理します。「その他」ではプロバイダーURLとモデルを指定できます。ブラウザからの呼び出しをプロバイダーが許可している必要があります。現行ランタイムはローカルのOllamaでも空でないキー入力が必要です。
2. 日時・人数をチャットで伝えます。ジャンル・場所は任意で、候補が15店以上の場合だけ未指定の希望を聞きます。両方とも指定なしなら全登録店が候補です。5店以上は4店ずつ確認でき、予算・コース要否・避けたい食材も任意です。
3. 絞り込んだ店数が先に表示されます。「確認する」でまとめて調べ、「条件を変える」で希望を見直します。店ごとの許可カードは出ません。
4. チャット内に表示される比較カードの「この店を見てみる」で、宛先と条件を確認して移動します。店側でもAIのキー設定が必要です。キーを店のURLへ引き継ぐことはありません。

キーをチャットへ入力しないでください。ローカルで公式ランタイムが保存するキーCookieは、同じホスト名の別ポートにも届きます。親は **localhost**、店は **127.0.0.1** と分け、支出上限の低いキーを使ってください。試用後は保存済み設定を削除し、タブを閉じてください。

## 実装と編集箇所

| ファイル | 役割 |
| --- | --- |
| `site/index.html`, `style.css`, `assistant.css` | 比較カードを含む公式チャット、登録店一覧 |
| `site/finder.js` | 予約条件の入力検証、状態、version、遷移前チェック |
| `site/script.js` | ページの描画と条件のタブ内保存 |
| `site/site-actions.js` | ページの操作を公式ランタイムへ登録する薄いラッパー |
| `site/site.js` | 公式テンプレートを基にした日本語の挨拶・確認ダイアログ |
| `site/inquiries.js` | ジャンル・場所による確認先の件数確認と接続範囲の制限 |
| `site/ai-setup.js` | 初回の設定モーダル、プロバイダー選択、公式設定UIの配置 |
| `site/shops.json` | 登録店の唯一の編集元。公開情報のみ |
| `src/reservation_finder.hocon` | ネットワークの指示・スキーマの編集元（JSONは有効なHOCON） |
| `src/agent-manifest.json` | マニフェストの編集元 |
| `scripts/build.mjs` | 店のURL・ツール名・ラベル・許可オリジン・配信ヘッダーの生成と公式ビルド |
| `vendor/upstream.json` | 公式コードの固定コミットとランタイムのSHA-256一覧 |

ネットワーク名は `reservation_finder`。窓口 `finder_front` が6つのページ操作と各店のネットワークを使い、`condition_checker` が条件の不足・矛盾を確認します。公式ランタイムは全エージェントにページ操作を提示するため、専門エージェントには操作を使わないよう指示しています。

| ページ操作 | effect | 呼び出す共通関数 |
| --- | --- | --- |
| `website_get_finder_state` | read | `FinderPage.getState` |
| `website_list_registered_shops` | read | `FinderPage.listShops` |
| `website_set_reservation_conditions` | write | `FinderPage.setConditions` |
| `website_confirm_shop_inquiries` | write | `ShopInquiries.confirm` |
| `website_show_candidates` | write | `FinderPage.showCandidates` |
| `website_open_shop_page` | irreversible | `FinderPage.openShopPage`（`checkOpenShop`で再検証） |

条件を編集するとversionが進み、現在の比較結果を無効にします。チャット内の過去のカードには条件変更の案内を表示し、移動ボタンを無効にします。古い確認結果の表示を防ぐため、`show_candidates`にも`expectedVersion`を必須で追加しています。移動確認の前と実行時の両方でversionを照合します。右上の「⋯」メニューの「会話をやり直す」では会話と比較結果を消します。AI設定の保存による再読み込みでは、条件の下書きだけを同じタブのsessionStorageから復元し、比較結果は再取得します。引き継ぐのは `aw/date/time/people/course/budget/avoid/course_id` のフラグメントだけで、メモ・連絡先・チャット・モデル設定・キーは転送しません。店側はフラグメントを再検証し、読んだ後に削除する必要があります。

入力上限は人数200名、予算1人100万円、メモ500文字。避けたい食材は8品目と自由語5個まで、各20文字。既知の日本語表記を `shrimp` 等へ正規化します。材料の「記載なし」は安全や除去対応を意味しません。

## 店舗チャットと店舗ページ

仕様は `gemihub-restaurant` の `specs/parent-restaurant.md` です。

- **開き方**: 比較カードか登録店一覧の「店のチャットを開く」、エージェントの `website_open_shop_chat`、または `/?shop=<店のID>` の直接指定。URL に入るのは店の ID だけです。未登録・不正な ID ではチャットを始めず、エラーと登録店一覧への導線を出します。
- **会話**: 同じチャット欄を、横断検索と店ごとの会話で切り替えます。会話ごとに画面のメッセージとモデルに渡す履歴（`engine.history`）を別に持つので、別の店の会話は混ざらず、「比較結果に戻る」で条件と結果はそのまま戻ります。
- **同意**: 店ごとに一度、店名と接続先を示した確認に答えるまで、その店には何も送りません。店舗チャット中に接続できるのはその店のネットワークと同じオリジンの MCP だけです（`site/shop-chat.js`、`site/inquiries.js`）。同意はページの再読み込みで消えます。
- **応答**: 窓口エージェントが、利用者の質問と表示中の検索条件（名前・連絡先・メモは除く）を店のネットワークへ送り、店のエージェントが自店の読み取り専用 MCP で答えます。AI のキーは親で設定したものだけを使い、店には渡りません。
- **AI 未設定で来た場合**: 設定ダイアログを出し、保存後の再読み込みでも同じ店のチャットに戻ります（店の ID だけを同じタブの sessionStorage に保存）。
- **店舗ページ**: 「店舗ページを開く」で店の予約ページを iframe でチャットの横に表示します（狭い画面ではチャットと切り替え）。条件の自動入力はしません。入力と確定は利用者が店のページで行い、結果も店のページに出ます。親は予約完了を表示しません。
- **表示できないとき**: 店のページから読み込み完了の合図（送信元とオリジンを検証）が 8 秒以内に届かなければ、その旨と「別タブで開く」を案内します。

店側は `AGENT_PARENT_URL` にこのサイトの URL を設定している必要があります（埋め込みとLLM中継の許可）。

```sh
# 店サーバー（AGENT_PARENT_URL=http://localhost:8090/ で起動済み）と npm start の両方が必要
npm run test:shop-chat
```

このテストは実際の店サーバーに対して、店の指定エラー、キー未設定からの復帰、同意前の無接触、店ネットワークと MCP の実行、キーが店に渡らないこと、iframe 内での手動予約、スマートフォン表示、会話の分離、埋め込み拒否時の案内を確認します。モデルの応答だけはテスト用に差し替えています。

## Linked sites

店側は別リポジトリ `gemihub-restaurant` の担当です。現在は仕様書のローカルURLを登録しています。基本情報は店側のデモデータと照合し、炉端 灯は新宿、ソーレは渋谷、広東 龍は横浜として登録しています。

| 店 | ネットワークURL | 予約ページ |
| --- | --- | --- |
| 炉端 灯 | `http://127.0.0.1:3000/s/akari/agent/reservation_concierge` | `http://127.0.0.1:3000/s/akari/reserve` |
| トラットリア ソーレ | `http://127.0.0.1:3000/s/trattoria-sole/agent/reservation_concierge` | `http://127.0.0.1:3000/s/trattoria-sole/reserve` |
| 広東 龍 | `http://127.0.0.1:3000/s/kanton-ryu/agent/reservation_concierge` | `http://127.0.0.1:3000/s/kanton-ryu/reserve` |

仕様書の店側起動コマンドは、店リポジトリで `DEMO_MODE=true SEED=restaurant-demo npm start` です。親リポジトリからは店側を起動・変更しません。店側の実装・起動後に実行します。

```sh
npm run check:partners
# 公開後の親オリジンを指定する場合:
npm run check:partners -- https://your-finder-host.example
```

空席・メニューの確認前に、ジャンル・場所から親の登録情報で件数を計算して一度確認します。この確認では店への通信は行いません。「確認する」の後だけ選んだ店のネットワークと同じオリジンのMCPへ接続し、条件変更・会話リセット後は以前の確認を使い回しません。未承認のネットワーク、異なるscheme・portの接続先は拒否します。

店への依頼は日付・時刻・人数・コース要否・任意の予算・食材だけ、140文字以内と指示しています。名前・メール・電話番号・予約番号・キー・メモは禁止としていますが、依頼文自体の機械的フィルタはありません。

店のネットワークは訪問者のブラウザで、親で選んだルーターとキーを使って動きます。店は親のキーや `website_*` を受け取りません。店のサイト操作を使わず、店自身のオリジンにある**読み取り専用MCP**で空席・材料を取得する設計です。MCPを備えていない店からはライブ情報を取得できず「確認できず」と扱います。店のmanifestは自店のMCPオリジンを許可し、MCPはCORSに対応する必要があります。

公開前に全店のURLをHTTPSへ変更して `npm run build -- --production` を実行します。生成される `tools`・`link_labels`・`allowed_peers`・ツール名・CSPをまとめて更新し、ループバックURLが残っていると失敗します。再度 `check:partners` を実行してください。

## 検証

```sh
npm run check
npm test
# 公式ビルドの直接実行:
node vendor/agentify-website/scripts/build_network.mjs site/reservation_finder.hocon --manifest site/agent-manifest.json --check
# 起動済みの親が他サイトから読み込めるか:
node vendor/agentify-website/scripts/check_partner.mjs http://localhost:8090/reservation_finder
```

Nodeテストは日時・食材・人数等の入力検証、条件変更による結果の無効化、状態のコピー、遷移の条件ホワイトリスト、公式ランタイムの操作スキーマ・確認・拒否・private context・合成上限・循環・不正ネットワークを検証します。外部LLMは呼びません。

ブラウザ検証は任意でPlaywrightを使います。`npm start` を別の端末で実行し、次を実行します。

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run test:browser
# 既存Chromiumを使う場合:
CHROMIUM_PATH=/path/to/chromium npm run test:browser
```

`FINDER_URL` で親URLを変更できます。テストはLLMと3店のレスポンスをブラウザ内で差し替え、実ネットワークランタイム・読み取り専用MCP・同意前の無接触・拒否・キーを店に渡さないこと・ルーター継承・比較・条件変更中の確認・遷移・PC/スマートフォン表示を検証します。撮影結果はgit対象外の `test-results/` です。これはテスト用の応答であり、実店舗との結合テストや実モデルの品質検証ではありません。

検証結果と未解決事項は [2026-11-14 結合テストレポート](docs/integration-test-report-2026-11-14.md) を参照してください。

## 静的公開

公開するフォルダは **`site/`だけ**です。ビルド済みの公開ファイルと無改変のランタイムを含みます。公開作業は未実施です。

`site/_headers` はNetlify互換の配信設定です。他のホストでは同じ設定を反映してください。

- `agent-manifest.json`、`reservation_finder.network.json`、`links.json`、`agent-mcp.json`、`.well-known/nsdeploy.json`、`.well-known/nsdeploy-agent.json` に `Access-Control-Allow-Origin: *`。
- `runtime/sandbox-worker.js` に `Content-Security-Policy: default-src 'none'; script-src blob:; connect-src 'none'; worker-src 'none'`。
- `bridge/` は `X-Frame-Options` や `frame-ancestors` で埋め込みを禁止しない。
- メインHTMLにCSP、全ファイルに `Referrer-Policy: no-referrer` と `X-Content-Type-Options: nosniff`。CSPは第三者スクリプトを許可せず、通信先は訪問者が選べるHTTPSルーターとローカル用HTTPルーター、frame先は登録店に限定します。公式のローカル配信ツールは `_headers` を解釈しないので、CORSとworker用CSP以外は公開ホスト側で確認が必要です。
- 本番はHTTPS。親と店は別ホストにし、キーを含むURL・分析ログ・外部スクリプトを追加しない。

親ネットワークURLは `http://localhost:8090/reservation_finder`（公開後はホストを置換）。別サイトから読み込むと親のページ操作は利用できず、親のページを案内します。さらに店を呼ぶ場合はその店への同意も求めます。公開後は [公式サイト一覧](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/agentic_websites.md) やNANDAへの掲載が可能です。外部への登録は行っていません。

## 公式コードと制限

[公式 agentify-website](https://github.com/cognizant-ai-labs/agentic-web/tree/63a956cf4653f610b1c238c70946f4d7647d17a8/skills/agentify-website) をコミット `63a956cf4653f610b1c238c70946f4d7647d17a8` で固定。規格本文は仕様参照版 `512d948` と差分なしでした。`site/runtime/`、`vendor/agentify-website/` は無改変コピー（Apache-2.0、同梱LICENSE参照）。ランタイムはビルド時にハッシュを照合します。`site/site.js` と `assistant.css`、テスト補助はテンプレートを本アプリに合わせて利用しています。

生成される `.network.json`・発見用ファイル・`bridge/` は手編集せず、編集元を変えて再ビルドしてください。公式ランタイムには以下の制約が残ります。

- `write`は確認なしで即実行され、規格の書き込み前提示とギャップがあります。本サイトでは条件・比較の取り消せる表示変更だけに使い、ページ遷移は`irreversible`にしています。
- 1メッセージにつき店への呼び出し4回、同じ店1回、エージェント呼び出し24回、開始時に90秒、ネスト5段の上限。上限を超える場合は対象を絞ります。
- 90秒は実行中のfetchを中断しません。応答のない店で止まった場合はリロードが必要です。書き込みの結果が不明なら自動再実行しません。
- ネットワーク定義と指示は公開情報で、機密には使えません。
- 別サイトのネットワークは信頼できない入力です。親のルーター・キー・private contextを上書きさせず、返答はデータとして扱うよう指示しています。確認対象外の呼び戻しや外部MCPへの接続は拒否します。

gemihub.net本番・`takeshy/gemihub`・kakerattaの変更、店側の実装、デプロイ、外部へのメッセージ送信は本リポジトリの実装範囲に含めていません。

比較カードは、空きあり・満席・予約不可（人数などの予約条件に合わない）・確認できず（未確認や接続失敗）を区別します。確認への同意がない場合も「確認できず」とし、予約できないと断定しません。
