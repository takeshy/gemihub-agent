// Wording of a restaurant's public agent bundle and reservation page.
// The bundle's text is the same for every visitor, so it is fixed here instead of following the request's language.

export const sampleQueries = () => [
  "今夜19時に2人、席だけ空いていますか？",
  "12月18日19時から12名、空いていますか？",
  "えびを使わないコースや料理はありますか？",
  "1人5,000円以内のコースはありますか？",
  "この条件で予約してください",
  "PayPalで前払いできますか？",
];
export const agentCopy = {
  brand: (name: string) => `${name} 予約アシスタント`,
  manifestDescription: (name: string) => `${name}の予約。少人数の席予約から宴会まで、空席、コースや料理の材料、予約を案内します。`,
  networkDescription: (name: string) => `${name}の予約（通常予約・席のみ・宴会）。空席、コースや料理の材料、予約を扱います。`,
};
/** The reservation page's own text; `name` is already escaped for HTML. */
export const reservePageCopy = (locale: "ja" | "en", name: string) => locale === "ja" ? {
  title: `${name} ご予約`, back: `← ${name}のページへ`, lead: "席だけの予約から、宴会・パーティーのコース予約まで。AIに相談して予約できます。",
  askAI: "AIに相談", closeChat: "元の画面に戻る", aiSettings: "AIの設定", closeSettings: "閉じる", settingsDescription: "ご自身のAIプロバイダーとAPIキーを設定します。キーはこのブラウザに保存され、選んだプロバイダーにだけ送られます。", provider: "プロバイダー", privacyHeading: "AIの利用について",
  form: "予約フォーム", date: "日付", people: "人数", course: "コース", time: "開始時刻", note: "食事の注記（避けたい食材など・任意）", name: "予約のお名前", phone: "電話番号",
  callback: "ご予約後、この電話番号へお店から確認のお電話を差し上げます。", noCallback: (minutes: number) => `お店からの確認のお電話はありません。ご予約時刻から${minutes}分を過ぎてもご来店がない場合は、他のお客様をご案内します。`, submit: "予約内容を確認する", carriedButton: "反映",
  assistant: `${name}の予約アシスタント`, assistantLead: "日時と人数を伝えると、空席を確かめ、コースや料理の材料を調べ、予約まで進めます。",
  privacy: "メッセージと、このページから読み取った内容は、「AIの設定」であなたが選んだ LLM プロバイダーに送られます。キーはこのブラウザだけに保存され、お店には送られません。予約の確定前には必ず確認画面が出ます。",
  key: "他のサイトから移動してきた場合も、キーはサイトごとに保存されるため、ここでもう一度設定してください（前のサイトと同じプロバイダーを選べます）。",
  connecting: "アシスタントを読み込んでいます… この表示のままの場合は読み込めていません。「AIに相談」からもう一度お試しください。",
  embeddedNote: "このページのチャットは、お店さがしサイトで設定したあなたのAIを使います。会話と、このお店のエージェントの定義は、お店さがしサイトを通してLLMに送られます。AIのキーはこのお店には渡りません。",
} : {
  title: `Reserve at ${name}`, back: `← Back to ${name}`, lead: "From seats for two to a banquet with a course. Ask the AI to reserve.",
  askAI: "Ask the AI", closeChat: "Back to the page", aiSettings: "AI settings", closeSettings: "Close", settingsDescription: "Choose your AI provider and enter your API key. Your key is saved in this browser and sent only to the provider you choose.", provider: "Provider", privacyHeading: "About using AI",
  form: "Reservation form", date: "Date", people: "Guests", course: "Course", time: "Start time", note: "Dietary note (foods to avoid; optional)", name: "Name for the reservation", phone: "Phone",
  callback: "After you reserve, the restaurant will call this number to confirm.", noCallback: (minutes: number) => `The restaurant will not call to confirm. If you have not arrived ${minutes} minutes after your reservation time, your seats go to other guests.`, submit: "Review the reservation", carriedButton: "Apply",
  assistant: `${name} reservation assistant`, assistantLead: "Tell it the date, time and party size: it checks the seats, looks up what courses and dishes contain, and takes the reservation.",
  privacy: "Your messages, and what the assistant reads from this page, go to the LLM provider you choose in AI settings. Your key stays in this browser and is never sent to the restaurant. You confirm a reservation before it is made.",
  key: "If you came from another site, add your key here too: keys are saved per site (you can pick the same provider).",
  connecting: "Loading the assistant… If this message stays, it could not load. Try again using Ask the AI.",
  embeddedNote: "The chat on this page uses the AI you set up on the restaurant finder site. The conversation and this restaurant's agent definition go to the LLM through that site. Your AI key is never given to this restaurant.",
};
