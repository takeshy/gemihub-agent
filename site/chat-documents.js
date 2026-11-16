const normalize = value => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
function terms(query) {
  const words = normalize(query).match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[a-z0-9]+/gu) || [];
  return [...new Set(words.flatMap(word => /^[a-z0-9]+$/.test(word) || word.length < 2 ? [word] : Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))))].slice(0, 200);
}

export function searchDocuments(documents, query, limit = 5) {
  if (typeof query !== "string" || !query.trim() || query.length > 500 || !Number.isInteger(limit) || limit < 1 || limit > 8) throw new Error("調べたい内容を500文字以内で指定してください。");
  const keywords = terms(query);
  const exact = normalize(query);
  const matches = [];
  for (const document of documents) {
    const title = normalize(document.name);
    for (let start = 0, part = 1; start < document.text.length; start += 1200, part++) {
      const content = document.text.slice(start, start + 1500);
      const haystack = normalize(content);
      const score = keywords.reduce((sum, word) => sum + (title.includes(word) ? 3 : 0) + (haystack.includes(word) ? 1 : 0), 0) + (haystack.includes(exact) ? 10 : 0);
      if (score) matches.push({ score, sourceId: document.id, source: document.name, updatedAt: document.updatedAt, part, text: content });
    }
  }
  matches.sort((a, b) => b.score - a.score || a.source.localeCompare(b.source) || a.part - b.part);
  return { results: matches.slice(0, limit).map(({ score, ...match }) => match), hasMore: matches.length > limit, documentCount: documents.length };
}

export async function searchChatDocuments(args, { fetch: fetchImpl = globalThis.fetch } = {}) {
  try {
    // Always revalidate (an operator may have removed or replaced a document during this visit), but
    // let the browser keep the file, so repeated searches get 304 instead of downloading it again.
    const response = await fetchImpl(new URL("./chat-documents.json", import.meta.url), { cache: "no-cache" });
    if (response.status === 404) return { ok: true, ...searchDocuments([], args.query, args.limit) };
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (data.version !== 1 || !Array.isArray(data.documents) || data.documents.length > 50 || data.documents.some(doc => typeof doc.id !== "string" || typeof doc.name !== "string" || typeof doc.text !== "string" || doc.text.length > 100000)) throw new Error();
    return { ok: true, ...searchDocuments(data.documents, args.query, args.limit) };
  } catch { return { ok: false, reason: "資料を検索できませんでした。少し待ってからお試しください。" }; }
}
