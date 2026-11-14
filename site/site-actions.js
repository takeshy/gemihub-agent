import { App } from "./script.js";

const string = (description, maxLength = 200) => ({ type: "string", maxLength, description });
const integer = (description, maximum, minimum = 0) => ({ type: "integer", minimum, maximum, description });
const shopId = { type: "string", enum: App.page.shops.map(shop => shop.id), description: "website_list_registered_shops が返した店のID。" };
const version = integer("同じターンに読んだ状態または条件更新の最新version。条件が変わると拒否されます。", Number.MAX_SAFE_INTEGER);

export function registerActions(actions) {
  const register = (name, description, effect, properties, required, execute) => actions.register({ name, description, effect,
    inputSchema: { type: "object", additionalProperties: false, properties, required }, execute });
  register("get_finder_state", "日本時間の今日と曜日、予約条件・比較結果・versionと、確認済みのジャンル/場所、画面内に開いている店openShop（なければnull）を読む。nullの希望は未確認。", "read", {}, [], () => ({ ...App.page.getState(), searchPreferences: App.inquiries?.preferences || { cuisine: null, area: null }, openShop: App.shopFrame?.shop ? { id: App.shopFrame.shop.id, name: App.shopFrame.shop.name } : null }));
  register("open_shop", "利用者が選んだ1店のページを、この画面内に開く。有効な検索条件（日時・人数・コース要否・予算・食材）はお店のページへ渡す。相談と予約は利用者がお店のページで行う。予約はしない。", "write",
    { shopId }, ["shopId"], args => App.shopFrame?.open(args.shopId) || { ok: false, reason: "準備ができていません。" });
  register("list_registered_shops", "登録店のid・店名・エリア・料理・pageUrl・networkUrl・networkToolを読む。空席や価格は含まない。", "read",
    { area: string("任意の場所。新宿、東京、横浜など。空文字は指定なし。", 80), cuisine: string("任意のジャンル。中華、イタリアン、和食など。空文字は指定なし。", 80) }, [], args => App.page.listShops(args));
  register("confirm_shop_inquiries", "ジャンル・場所と日時人数がそろったら使う。親の情報で絞った問い合わせ先の件数をチャットに示し、一度だけ問い合わせるか聞く。approved:trueの店だけ問い合わせる。", "write", {
    cuisine: string("利用者に確認した希望ジャンル。明示的に指定なし・おまかせなら空文字。", 80),
    area: string("利用者に確認した場所。明示的に指定なし・どこでもなら空文字。", 80), expectedVersion: version,
  }, ["cuisine", "area", "expectedVersion"], args => App.inquiries?.confirm(args) || { ok: false, reason: "問い合わせの準備ができていません。" });
  register("set_reservation_conditions", "利用者がチャットで指定した予約条件を保存し、古い比較結果を消す。予約は行わない。更新後の条件とversionを返す。", "write", {
    date: string("日本時間の実在する日付 YYYY-MM-DD。今日の日付はget_finder_stateから読む。", 10),
    time: string("日本時間の開始時刻 HH:MM。", 5), partySize: integer("利用者が指定した人数（1〜200名）。", 200, 1),
    course: { type: "string", enum: ["none", "wanted", "any"], description: "none=席のみ、wanted=コース希望、any=どちらでも（既定）。" },
    budgetPerPerson: integer("任意の1人あたり予算（円）。合計予算ではない。", 1000000, 1),
    avoid: { type: "array", maxItems: 13, items: string("避けたい食材名。8品目または自由語5個まで。", 20), description: "利用者が避けたい食材。連絡先やキーを含めない。" },
    note: string("相談用メモ。店への依頼やURLにこの文字列をコピーしない。", 500),
  }, ["date", "time", "partySize"], args => App.page.setConditions(args));
  register("show_candidates", "店の回答に基づく比較カードと予約へ進むボタンをチャット内に表示する。拒否・失敗・空返答はdeclinedかunknown。推測した空席・価格・食材判定を入れない。", "write", {
    expectedVersion: version,
    candidates: { type: "array", maxItems: App.page.shops.length, description: "問い合わせた店の回答。", items: {
      type: "object", additionalProperties: false, required: ["shopId", "status", "summary"], properties: {
        shopId, status: { type: "string", enum: ["available", "full", "unknown", "declined"], description: "店の回答または同意の拒否から決める。" },
        remaining: integer("店が回答した残り席数。", 10000), durationMinutes: integer("店が回答した利用時間（分）。", 10000),
        seatOnly: { type: "boolean", description: "店が席のみ予約を受け付けるか。" },
        courseId: string("店が返したコースID。", 80), courseName: string("店が返したコース名。"),
        priceText: string("店の回答の1人単価と、人数から計算した合計見込み。"),
        avoidResult: string("含む・記載なし・不明を区別。安全や除去対応を保証しない。", 1000),
        summary: string("店の回答の短い要約。確認できない理由も正直に書く。", 1000),
      },
    } },
  }, ["candidates", "expectedVersion"], args => App.page.showCandidates(args));
  register("open_shop_page", "店の予約ページへ移動する。店名・ホスト・引き継ぐ条件をブラウザで確認してから実行。予約確定は店のページで行う。", "irreversible", {
    shopId, courseId: string("最新の比較結果にあるコースID。席のみなら指定しない。", 80), expectedVersion: version,
  }, ["shopId", "expectedVersion"], args => App.page.openShopPage(args));
}
