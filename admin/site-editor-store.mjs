import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultDesign, validateDesign, renderDesign, previewDesign, atomicFile, codeRoot, designImageIds } from "./site-design.mjs";
import { createSiteImages, annotationMedia, imageIds as validateImageIds } from "./site-images.mjs";

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const revision = config => createHash("sha256").update(JSON.stringify(config)).digest("hex");
const metadata = ({ id, at, summary, request, createdBy, baseRevision, appliedAt, imageIds }) => ({ id, at, summary, request, createdBy, baseRevision, appliedAt, imageIds });
export function createSiteEditor({ root, sourceRoot = codeRoot, generate, configured = false, write = atomicFile } = {}) {
  const statePath = join(root, "admin/site-editor.json");
  const images = createSiteImages({ root });
  let pending = Promise.resolve(), generating = false;
  const exclusive = operation => { const next = pending.then(operation); pending = next.catch(() => {}); return next; };
  async function read() {
    let state;
    try { state = JSON.parse(await readFile(statePath, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; state = { version: 1, published: { id: "initial", config: await defaultDesign(sourceRoot), summary: ["最初のデザイン"], at: null }, versions: [], proposals: [] }; }
    if (state.version !== 1 || !state.published || !Array.isArray(state.versions) || !Array.isArray(state.proposals)) fail(500, "ページの保存情報を確認してください。");
    state.published.config = await validateDesign(state.published.config, sourceRoot);
    return state;
  }
  function status(state) { return { revision: revision(state.published.config), configured, published: metadata(state.published), versions: state.versions.map(metadata), proposals: state.proposals.map(metadata) }; }
  function check(state, expected) { if (typeof expected !== "string" || revision(state.published.config) !== expected) fail(409, "公開内容が更新されました。最新の内容を読み込んでからやり直してください。"); }
  function source(state, id) {
    if (id === "published" || id === state.published.id) return state.published;
    const value = [...state.proposals, ...state.versions].find(v => v.id === id);
    if (!value) fail(404, "変更案が見つかりません。最新の内容を読み込んでください。");
    return value;
  }
  return {
    get: () => exclusive(async () => status(await read())),
    async propose({ request, revision: expected, sourceId = "published", media: rawMedia, imageIds = [] } = {}, user, shops, signal) {
      if (typeof request !== "string" || !request.trim() || request.length > 4000) fail(400, "変更したい内容を4000文字以内で入力してください。");
      if (!configured || !generate) fail(503, "管理サーバーにGeminiのAPIキーを設定してください。");
      if (generating) fail(429, "変更案を作成中です。完了してからもう一度お試しください。");
      generating = true;
      try {
        validateImageIds(imageIds);
        const base = await exclusive(async () => { const state = await read(); check(state, expected); const current = source(state, sourceId); if (current.baseRevision && current.baseRevision !== expected) fail(409, "この変更案は公開内容より古くなりました。公開中の内容から作り直してください。"); return current.config; });
        const media = await annotationMedia(rawMedia), attachments = await images.inline(imageIds);
        const generated = await generate({ request: request.trim(), current: base, shops, signal, media, images: attachments });
        const config = await validateDesign(generated.config, sourceRoot);
        for (const id of designImageIds(config)) await images.read(id);
        if (!Array.isArray(generated.summary) || !generated.summary.length || generated.summary.length > 12 || generated.summary.some(s => typeof s !== "string" || !s.trim() || s.length > 500)) fail(502, "変更内容の説明を読み取れませんでした。もう一度お試しください。");
        return await exclusive(async () => {
          const state = await read(); check(state, expected);
          const proposal = { id: randomUUID(), at: new Date().toISOString(), config, summary: generated.summary, request: request.trim(), createdBy: user.email, baseRevision: expected, imageIds };
          state.proposals = [proposal, ...state.proposals].slice(0, 10);
          await write(statePath, JSON.stringify(state, null, 2) + "\n", 0o600);
          return { ...status(state), proposal: metadata(proposal), message: "変更案を作りました。まだ公開されていません。" };
        });
      } finally { generating = false; }
    },
    preview: (id, shops, expected) => exclusive(async () => { const state = await read(); if (expected !== undefined) check(state, expected); return previewDesign(await validateDesign(source(state, id).config, sourceRoot), shops, sourceRoot, images); }),
    publish: ({ sourceId, revision: expected } = {}, user) => exclusive(async () => {
      const state = await read(); check(state, expected); const selected = source(state, sourceId);
      if (selected.baseRevision && selected.baseRevision !== expected) fail(409, "この変更案は公開内容より古くなりました。公開中の内容から作り直してください。");
      const config = await validateDesign(selected.config, sourceRoot);
      if (revision(config) === expected) return { ...status(state), message: "公開中の内容と同じです。" };
      const page = await renderDesign(config, sourceRoot), indexPath = join(root, "site/index.html");
      let previous; try { previous = await readFile(indexPath); } catch (error) { if (error.code !== "ENOENT") throw error; previous = await readFile(join(sourceRoot, "site/index.html")); }
      const next = { ...state, published: { id: randomUUID(), config, at: new Date().toISOString(), summary: selected.baseRevision ? selected.summary : ["選んだ履歴の内容に戻しました。"], createdBy: user.email }, versions: [], proposals: state.proposals.map(p => p.id === selected.id ? { ...p, appliedAt: new Date().toISOString() } : p) };
      next.versions = [next.published, state.published, ...state.versions.filter(v => v.id !== state.published.id)].slice(0, 11);
      await write(join(root, "site", page.cssName), page.css);
      const createdImages = await images.publish(designImageIds(config));
      try {
        // CSS is immutable; the index selects its complete version in one rename.
        await write(indexPath, page.html);
        await write(statePath, JSON.stringify(next, null, 2) + "\n", 0o600);
      } catch (error) { await atomicFile(indexPath, previous); await images.rollback(createdImages); throw error; }
      return { ...status(next), message: "案内ページに反映しました。" };
    }),
  };
}
