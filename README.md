# gemihub-agent

お店紹介と予約案内の親サイト。雑貨店・文具店・飲食店などをジャンルや場所で探し、紹介文や店舗サイトへ案内します。通常のWebサイトも登録でき、エージェントの有無と予約対応は独立して扱います。店舗紹介には日時・人数は不要です。エージェントがある店には承認後に商品・店舗情報を問い合わせられます。予約対応の店では空席・メニューを比較して予約ページへ案内します。購入・決済・予約の確定や変更は店舗サイトで行います。

店舗紹介の仕様: [specs/SHOP_INTRODUCTION_SPEC.md](specs/SHOP_INTRODUCTION_SPEC.md)。飲食店予約の仕様: [specs/restaurant-spec.md](specs/restaurant-spec.md) v0.3。

親サイトの管理画面にある「チャットの資料」では、地域のお知らせ・公共施設・イベントなどのファイルをアップロードできます。「本文を読み込む」で内容を確認・修正し、「公開する」でチャットの回答に使います。下書き保存、編集、公開解除、削除もできます。店舗に関わらない質問は公開資料を検索して回答し、資料名を添えます。資料で確認できない内容は推測しません。

対応形式はテキスト・Markdown・CSV・JSON（UTF-8）・PDFで、1ファイル5MB・本文10万文字、全体で50件・200万文字までです。PDFは運営のGeminiで文字を読み取るため、管理サーバーの`GEMINI_API_KEY`が必要です。読み取り結果を公開前に確認してください。公開した資料名と本文は誰でも読めるようになり、回答に必要な抜粋は利用者のAIへ送られます。公開解除後も、すでに表示された回答や会話履歴には残ります。

原本ファイルは保存せず、確認した本文と下書きを`admin/chat-documents.json`、公開した本文だけを`site/chat-documents.json`に保存します。これらはGit・ビルド転送対象から除外し、devの永続領域では再デプロイ時も保持します。静的サイトを別の環境へ配信する場合は公開資料も配信先へ同期してください。検索は本文を分割したキーワード検索です。埋め込みモデルや外部検索サービスは使いません。検証: `npm run test:finder`、`npm run test:chat-documents`。

`npm run storybook`で **http://localhost:6005/** を開くと、「お店さがしの運営 / 管理画面」に資料なし・公開中と下書き・本文確認のストーリーがあります。「お店さがし / トップページ」の「公開資料から地域の情報を回答」では資料検索と回答例を確認できます。資料のアップロードや公開もサンプルの状態だけを更新し、実際の管理APIやAIには接続しません。PDFの読み取り結果は固定の例です。

運営のGeminiが有効なら、親ページの「音声で話す」から資料案内も音声で相談できます。店名を指定して話したいと伝えるか、「話し相手」で店を選ぶと、その店舗の公開チャットへ音声の質問をつなぎます。親の会話履歴・マイク音声・キーは店舗へ渡しません。予約などの確定は画面で確認します。音声の設定・上限は[運営のGeminiとBYOK](docs/managed-ai.md#親の音声会話)を参照してください。Storybookの「地域の案内を音声で相談」「話し相手を店舗に切り替える」は、マイクや実際のAIを使わない動作例です。

## 起動

Node.js 24以上。店舗アプリを `apps/shop/` に含むnpm workspacesのモノレポです。依存関係とロックファイルはルートで管理します。

AIは標準で運営の `GEMINI_API_KEY` を使い、Hydrogen / lowで利用できます。「AIの設定」から自分のキーを使うBYOKにも切り替えられます。[設定と動作](docs/managed-ai.md)を参照してください。

```sh
npm ci
npm run build
npm test
npm start
```

ブラウザで **http://localhost:8090/** を開きます。`file://` では使えません。

親サイト・店舗管理・飲食店3店のデモをまとめて起動する場合は、ビルド後に `npm run dev:demo` を実行します。8090・8091・3000番ポートを使い、Ctrl+Cでまとめて停止します。起動済みのプロセスがある場合は先に停止してください。`FINDER_PORT`・`ADMIN_PORT`・`SHOP_PORT` で変更できます。店舗デモはメモリ内のデータを使い、終了すると消えます。店舗ポートを変更した場合、親サイトの登録URLも管理画面で合わせてください。

| コマンド | 対象 |
| --- | --- |
| `npm run build` / `npm test` / `npm run check` | 親サイトと店舗アプリの両方 |
| `npm run build:finder` / `npm run test:finder` / `npm run check:finder` | 親サイトのみ |
| `npm run build:shop` / `npm run test:shop` / `npm run check:shop` | 店舗アプリのみ |
| `npm start` / `npm run admin` | 親サイト / 店舗管理 |
| `npm run start:shop` / `npm run dev:shop` | 店舗アプリの通常起動 / 自動再起動 |

店舗アプリの設定は `apps/shop/.env` を使います。詳しくは [店舗アプリのREADME](apps/shop/README_ja.md) と [モノレポの構成・移行記録](docs/monorepo.md) を参照してください。公開サイトの配信フォルダは従来どおり `site/` です。

店舗管理と招待には、許可した運営者のGoogleログインが必要です。Gmailから招待・認証メールを送ります。設定手順とCloud Storage・メールログイン・ZIP書き出しの仕様は [保存先と認証](docs/storage-auth.md) を参照してください。

管理画面の「お店さがしのページ」→「AIでページを編集」から、公開ページの文章・配色・レイアウトを変更できます。店舗ページと共通の画像添付・赤ペン・比較画面を使い、変更案を「OK」で採用してから「この内容を反映する」で公開します。公開した履歴から元に戻すこともできます。管理サーバーのGemini設定を使い、登録店や検索・予約連携は維持します。開発環境では再デプロイ後もデザインと履歴が残ります。

店舗管理は別プロセスで起動します。

```sh
npm run admin
# ポート変更:
ADMIN_PORT=8092 npm run admin
# 公開用のHTTPS URLだけ登録する場合:
npm run admin -- --production
```

**http://127.0.0.1:8091/** で「店を追加」を押し、店舗トップ・予約ページ・エージェントのURLを入れて「読み込む」。店名と住所から推定したエリア、地図用の詳しい住所に加え、店名・紹介文からAIがジャンルの初期値を入力します。各項目は編集でき、**「保存」を押すまで店舗データは変わりません**。店舗のMCPやAIから取得できない項目は手入力で続けられます。編集時の「店から取り直す」では変更項目を確認して選択し、保存で反映します。保存済みのジャンルは保持し、AIで上書きしません。一覧の上下ボタンで表示・生成物の並びを変更できます。AIが問い合わせる順番はAIの判断によります。

通常の店舗サイトはページのタイトル、説明文、構造化データから取り込みます。紹介文は公開する店舗情報として保存します。エージェントがある場合だけ「ネットワークURL」を設定し、予約ページも案内したい場合は独立した「予約ページも案内する」を有効にして予約URLを指定します。エージェントが存在するだけでは予約対応にしません。住所などを取得できないサイトでは不足項目を手入力できます。

ジャンルは [Gemini Decisions API](https://aistudio.google.com/docs/decisions-api) の `gemini-decision-1` で判定します。管理画面のAI設定・モデル選択はありません。起動前に環境変数 `GEMINI_API_KEY` を設定するか、`.env.example` を `.env` にコピーしてキーを設定してください。`npm run admin` は `.env` を読み込みます。店名・紹介文を基に基本のジャンル分類と既存の登録ジャンルから選択し、結果は編集できます。キーは管理サーバーだけで使用し、ブラウザ・店舗・店舗データ・キャッシュには渡しません。キー未設定・判定失敗時は案内を表示し、ジャンルを手入力できます。

保存は既存の `validateShops()` で検証し、一時領域で公式ビルドまで成功してから `site/shops.json` と生成物を置き換えます。画面には保存の完了と再読み込みの案内だけを表示し、生成ファイルの一覧は出しません。エラー時は元のファイルを維持し、反映途中に失敗した場合も復元します。既存の検証どおり1店以上が必要なので、最後の1店の削除はエラーになります。公開サイトを再読み込みすると変更を利用できます。取得日時・取り込み時の紹介文・予約条件の要約・接続状態はgit対象外の `admin/cache.json` に保存し、編集した公開用の紹介文は店舗データに保存します。

ローカルの管理サーバーはループバックで待ち受けます。devでは専用HTTPSオリジンと運営者Googleログインで保護します。変更操作では同一OriginとJSON送信を必須にし、管理API・キャッシュ・編集中の画像は公開フォルダーに含めません。詳細は [管理画面の仕様](specs/ADMIN_SPEC.md) を参照してください。

1. 未設定の場合は最初に「AIを設定して始める」モーダルが開きます。プロバイダーをプルダウンで選び、自分のAPIキーを入力して **保存して始める**。Otariを選ぶと、OtariのURLと`alibaba/qwen3.8-flash`が自動入力されます。設定済みならモーダルを省略し、ページの **AIの設定** から変更できます。既定は OpenRouter / `openai/gpt-6-luna`（GPT-6 Luna）。保存済み設定のモデル指定はサイトの既定より優先されるため、以前のモデルを保存済みなら詳細設定のModel欄も変更してください。キーの保存は公式ランタイムが管理します。「その他」ではプロバイダーURLとモデルを指定できます。ブラウザからの呼び出しをプロバイダーが許可している必要があります。現行ランタイムはローカルのOllamaでも空でないキー入力が必要です。
2. 「新宿の雑貨店」「贈り物が見つかるお店」など、探しているものをチャットで伝えます。紹介は日時・人数なしで利用できます。予約の空席確認を希望する場合だけ日時・人数を伝えます。ジャンル・場所は任意で、候補が15店以上の場合だけ未指定の希望を聞きます。エージェントへの問い合わせは4店ずつ確認します。
3. 店舗紹介では紹介カードから店舗サイトを開けます。エージェントへの問い合わせを希望した場合は、対象と内容を確認してから「確認する」で問い合わせます。
4. 予約対応店はカードの「予約ページへ」から進めます。店側でもAIを使う場合はキー設定が必要です。キーを店のURLへ引き継ぐことはありません。

キーをチャットへ入力しないでください。ローカルで公式ランタイムが保存するキーCookieは、同じホスト名の別ポートにも届きます。親は **localhost**、店は **127.0.0.1** と分け、支出上限の低いキーを使ってください。試用後は保存済み設定を削除し、タブを閉じてください。

## 実装と編集箇所

| ファイル | 役割 |
| --- | --- |
| `site/index.html`, `style.css`, `assistant.css` | 比較カードを含む公式チャット、登録店一覧 |
| `site/finder.js` | 店舗紹介と予約条件の状態・検証、遷移前チェック |
| `site/shop-data.js` | エージェントと予約対応を独立して判定する共通処理 |
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

ネットワーク名は互換性のため `reservation_finder` のままです。窓口 `finder_front` が8つのページ操作と登録済みの店のエージェントを使います。`condition_checker` は予約条件の不足・矛盾だけを確認します。

| ページ操作 | effect | 呼び出す共通関数 |
| --- | --- | --- |
| `website_get_finder_state` | read | `FinderPage.getState` |
| `website_list_registered_shops` | read | `FinderPage.listShops` |
| `website_show_shop_introductions` | write | `FinderPage.showIntroductions` |
| `website_set_reservation_conditions` | write | `FinderPage.setConditions` |
| `website_confirm_shop_inquiries` | write | `ShopInquiries.confirm` |
| `website_show_candidates` | write | `FinderPage.showCandidates` |
| `website_open_shop_page` | irreversible | `FinderPage.openShopPage`（`checkOpenShop`で再検証） |

条件を編集するとversionが進み、現在の比較結果を無効にします。チャット内の過去のカードには条件変更の案内を表示し、移動ボタンを無効にします。古い確認結果の表示を防ぐため、`show_candidates`にも`expectedVersion`を必須で追加しています。移動確認の前と実行時の両方でversionを照合します。右上の「⋯」メニューの「会話をやり直す」では会話と比較結果を消します。AI設定の保存による再読み込みでは、条件の下書きだけを同じタブのsessionStorageから復元し、比較結果は再取得します。引き継ぐのは `aw/date/time/people/course/budget/avoid/course_id` のフラグメントだけで、メモ・連絡先・チャット・モデル設定・キーは転送しません。店側はフラグメントを再検証し、読んだ後に削除する必要があります。

入力上限は人数200名、予算1人100万円、メモ500文字。避けたい食材は8品目と自由語5個まで、各20文字。既知の日本語表記を `shrimp` 等へ正規化します。材料の「記載なし」は安全や除去対応を意味しません。

## 店舗ページと予約チャット

仕様は [apps/shop/specs/parent-restaurant.md](apps/shop/specs/parent-restaurant.md) です。

- 比較結果は回答文の後に表示します。「お店を開く」で店舗トップを、予約条件がある場合の「予約ページへ」で予約画面を開きます。
- 店舗表示中は検索画面を隠し、親のヘッダーは「お店探しに戻る」だけにします。戻ると検索条件・回答・カードがそのまま残ります。
- 子の「AIに相談」を押した時に、親のAI設定で中継を開始します。ON/OFFや追加の許可カードはありません。キー本体は子へ渡さず、子のLLM呼び出しを親から選択済みプロバイダーへ中継します。
- 子はチャットだけを全画面に表示し、「元の画面に戻る」で店舗ページへ戻れます。親からの予約条件はチャット内に示し、「反映」を押すと条件をユーザーメッセージとして投稿します。予約確定は店舗の確認画面で承認した場合だけ実行します。
- 店舗トップと予約ページの埋め込み・中継には、店舗側の `AGENT_PARENT_URL` 設定が必要です。表示できない場合は別タブで開く導線を示します。別タブに親のキーを引き継ぎません。
- モデル・送信先・40回/30分の上限は親が管理します。親で店舗を閉じると実行中のLLM呼び出しを中断し、前の店舗のセッションは再利用しません。

```sh
# 店舗デモサーバーと npm start の両方が必要
npm run test:shop-frame
```

## Linked sites

店側の実装は `apps/shop/` にあります。現在は仕様書のローカルURLを登録しています。基本情報は店側のデモデータと照合し、炉端 灯は新宿、ソーレは渋谷、広東 龍は横浜として登録しています。

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

公開前に全店のURLをHTTPSへ変更して `npm run build:finder -- --production` を実行します。生成される `tools`・`link_labels`・`allowed_peers`・ツール名・CSPをまとめて更新し、ループバックURLが残っていると失敗します。再度 `check:partners` を実行してください。

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
npx playwright install chromium
npm run test:browser
# 既存Chromiumを使う場合:
CHROMIUM_PATH=/path/to/chromium npm run test:browser
```

管理画面のブラウザ検証は、店舗側で `DEMO_MODE=true SEED=restaurant-demo npm start` を起動してから `npm run test:admin` を実行します。`SHOP_ORIGIN`（既定 `http://127.0.0.1:3000`）、`FINDER_PORT`（既定 `18090`）、`PLAYWRIGHT_MODULE`、`CHROMIUM_PATH` で接続先とブラウザを変更できます。一時コピーで3店のURL登録・差分反映・並び替え・削除・スマートフォン表示を確認し、生成された親サイトのチャットから実店舗の読み取り専用MCPへ接続します。LLMの返答だけは固定し、有料モデルを呼びません。作業中の `site/shops.json` と公開ファイルは変更しません。

公開側の登録店一覧はジャンルで絞り込み、選んだお店の住所をGoogleマップに表示します。APIキーは使わず、お店の選択に合わせて地図を切り替えます。詳しい住所がない店には確認の案内を表示します。

AIページ編集のブラウザ検証は `node tests/site-editor-browser-check.mjs` を実行します。一時的な公開・管理サーバーと固定のモデル応答を使い、PC・スマホで変更案、追加修正、反映、履歴復元と公開後の店舗紹介を確認します。

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
