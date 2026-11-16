import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Firestore } from "@google-cloud/firestore";
import { tr } from "../shared/i18n.ts";

type RecordValue = Record<string, any>;
type Counter = { id: string; limit: number; expiresAt: Date };
export interface AiState {
  charge(counters: Counter[]): Promise<void>;
  read(ids: string[]): Promise<(RecordValue | undefined)[]>;
  write(entries: { id: string; value: RecordValue }[]): Promise<void>;
}
const failure = (status: number, message: string) => Object.assign(new Error(message), { status });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const canonical = (value: any): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const callHash = (call: RecordValue) => hash(call.function.name + ":" + canonical(JSON.parse(call.function.arguments || "{}")));

export function memoryAiState(): AiState {
  const values = new Map<string, RecordValue>();
  return {
    async charge(counters) {
      for (const c of counters) if ((values.get(c.id)?.count || 0) >= c.limit) throw failure(429, tr("AIの利用上限に達しました。しばらくしてからお試しください。"));
      for (const c of counters) values.set(c.id, { count: (values.get(c.id)?.count || 0) + 1, expiresAt: c.expiresAt });
    },
    async read(ids) { return ids.map(id => values.get(id)); },
    async write(entries) { for (const entry of entries) values.set(entry.id, entry.value); },
  };
}
function firestoreAiState(): AiState {
  const db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT, databaseId: process.env.FIRESTORE_DATABASE_ID || "(default)", ignoreUndefinedProperties: true });
  const records = db.collection("gemihub_public_ai");
  return {
    async charge(counters) {
      await db.runTransaction(async tx => {
        const docs = await tx.getAll(...counters.map(c => records.doc(c.id)));
        for (let i = 0; i < docs.length; i++) if ((docs[i].get("count") || 0) >= counters[i].limit) throw failure(429, tr("AIの利用上限に達しました。しばらくしてからお試しください。"));
        for (let i = 0; i < docs.length; i++) tx.set(docs[i].ref, { count: (docs[i].get("count") || 0) + 1, expiresAt: counters[i].expiresAt });
      });
    },
    async read(ids) { return ids.length ? (await db.getAll(...ids.map(id => records.doc(id)))).map(doc => doc.exists ? doc.data() : undefined) : []; },
    async write(entries) { if (!entries.length) return; const batch = db.batch(); for (const entry of entries) batch.set(records.doc(entry.id), entry.value); await batch.commit(); },
  };
}

/** A same-origin Gemini gateway. Provider credentials never leave this process. */
export function publicAi({ env = process.env, fetch: fetchImpl = globalThis.fetch, state, now = () => Date.now() }: { env?: Record<string, string | undefined>; fetch?: typeof fetch; state?: AiState; now?: () => number } = {}) {
  const secret = env.SESSION_SECRET || randomBytes(32).toString("hex");
  const key = env.GEMINI_API_KEY || "", model = env.GEMINI_PUBLIC_MODEL || env.GEMINI_MODEL || env.VERTEX_MODEL || "gemini-4-hydrogen";
  const reasoning = ["low", "medium", "high"].includes(env.GEMINI_THINKING_LEVEL || "") ? env.GEMINI_THINKING_LEVEL! : "low";
  const enabled = !!key && env.PUBLIC_AI_MODE !== "byok";
  const limit = (name: string, fallback: number) => { const n = Number(env[name]); return Number.isSafeInteger(n) && n > 0 ? n : fallback; };
  const sign = (value: RecordValue) => { const text = Buffer.from(JSON.stringify(value)).toString("base64url"); return `${text}.${createHmac("sha256", secret).update(text).digest("base64url")}`; };
  const verify = (token: string): RecordValue | undefined => {
    if (typeof token !== "string" || token.length > 2048) return;
    const parts = token.split("."); if (parts.length !== 2) return;
    const [text, mac] = parts; if (!text || !mac) return;
    const expected = createHmac("sha256", secret).update(text).digest("base64url");
    if (Buffer.byteLength(mac) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return;
    try { const value = JSON.parse(Buffer.from(text, "base64url").toString()); return value.expires > now() && typeof value.sid === "string" ? value : undefined; } catch { return; }
  };
  let backend = state, active = 0, liveActive = 0;
  const data = () => backend ||= firestoreAiState();
  const body = async (req: IncomingMessage, maximum = 512 * 1024) => {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) throw failure(415, tr("JSONで送信してください。"));
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) { size += chunk.length; if (size > maximum) throw failure(413, tr("メッセージが長すぎます。")); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw failure(400, tr("メッセージの形式を確認してください。")); }
  };
  return {
    async authorizeLive(req: IncomingMessage, token: string, allowedOrigins: string[]) {
      const requestOrigin = String(req.headers.origin || "");
      const session = verify(token);
      if (!enabled || env.PUBLIC_AI_VOICE === "false" || !session || session.origin !== requestOrigin || !allowedOrigins.includes(requestOrigin)) throw failure(403, "Voice session refused");
      if (liveActive >= 2) throw failure(429, "Voice sessions busy");
      liveActive++;
      let released = false;
      const release = () => { if (!released) { released = true; liveActive--; } };
      try {
        const ip = env.PUBLIC_AI_TRUST_PROXY === "true" ? String(req.headers["x-forwarded-for"] || req.socket.remoteAddress).split(",").at(-1)!.trim() : req.socket.remoteAddress || "unknown";
        const day = Math.floor(now() / 86400000), hour = Math.floor(now() / 3600000);
        await data().charge([
          { id: hash(`live:global:${day}`), limit: limit("PUBLIC_AI_LIVE_DAILY_LIMIT", 60), expiresAt: new Date((day + 2) * 86400000) },
          { id: hash(`live:ip:${day}:${ip}:${secret}`), limit: limit("PUBLIC_AI_LIVE_IP_DAILY_LIMIT", 10), expiresAt: new Date((day + 2) * 86400000) },
          { id: hash(`live:session:${hour}:${session.sid}`), limit: 4, expiresAt: new Date((hour + 2) * 3600000) },
        ]);
        return release;
      } catch (error) { release(); throw error; }
    },
    async handle(req: IncomingMessage, res: ServerResponse, allowedOrigins: string[]): Promise<boolean> {
      const path = (req.url || "").split("?")[0]; if (!path.startsWith("/api/ai/")) return false;
      const json = (status: number, value: RecordValue) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
      const requestOrigin = String(req.headers.origin || "");
      let phase = "request";
      try {
        if (requestOrigin && !allowedOrigins.includes(requestOrigin)) throw failure(403, tr("このサイトからAIを利用してください。"));
        if (path === "/api/ai/config" && req.method === "GET") { json(200, { managed: enabled, defaultMode: enabled ? "managed" : "byok", model: enabled ? model : "", reasoning, router: "/api/ai/v1", byok: true, voice: enabled && env.PUBLIC_AI_VOICE !== "false" }); return true; }
        if (!enabled) throw failure(503, tr("運営側のGeminiは現在利用できません。AIの設定からご自身のAPIキーも使えます。"));
        const ip = env.PUBLIC_AI_TRUST_PROXY === "true" ? String(req.headers["x-forwarded-for"] || req.socket.remoteAddress).split(",").at(-1)!.trim() : req.socket.remoteAddress || "unknown";
        const hour = Math.floor(now() / 3600000), day = Math.floor(now() / 86400000);
        if (path === "/api/ai/session" && req.method === "POST") {
          if (!allowedOrigins.includes(requestOrigin)) throw failure(403, tr("このサイトからAIを利用してください。"));
          await body(req, 1024);
          await data().charge([{ id: hash(`issue:${hour}:${ip}:${secret}`), limit: 60, expiresAt: new Date((hour + 2) * 3600000) }]);
          const cookie = String(req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith("gemihub_ai="))?.slice(11) || "";
          const old = verify(cookie), sid = old?.origin === requestOrigin ? old.sid : randomBytes(24).toString("base64url");
          res.setHeader("Set-Cookie", `gemihub_ai=${sign({ sid, origin: requestOrigin, expires: now() + 7 * 86400000 })}; HttpOnly; SameSite=Strict; Path=/api/ai; Max-Age=604800${requestOrigin.startsWith("https:") ? "; Secure" : ""}`);
          json(200, { token: sign({ sid, origin: requestOrigin, expires: now() + 2 * 3600000 }), expiresIn: 7200, model, router: "/api/ai/v1" }); return true;
        }
        const session = verify(String(req.headers.authorization || "").replace(/^Bearer /, ""));
        if (!session || !allowedOrigins.includes(session.origin) || requestOrigin && session.origin !== requestOrigin) throw failure(401, tr("AIの接続期限が切れました。ページを再読み込みしてください。"));
        if (path === "/api/ai/v1/models" && req.method === "GET") { json(200, { object: "list", data: [{ id: model, object: "model" }] }); return true; }
        if (path !== "/api/ai/v1/chat/completions" || req.method !== "POST") throw failure(404, tr("見つかりません。"));
        if (!allowedOrigins.includes(requestOrigin)) throw failure(403, tr("このサイトからAIを利用してください。"));
        const input = await body(req);
        if (!input || !Array.isArray(input.messages) || !input.messages.length || input.messages.length > 160 || input.messages.some((m: any) => !m || typeof m !== "object") || input.tools && (!Array.isArray(input.tools) || input.tools.length > 128)) throw failure(400, tr("メッセージの形式を確認してください。"));
        if (active >= 2) { res.setHeader("Retry-After", "3"); throw failure(429, tr("AIが混み合っています。少し待ってからお試しください。")); }
        active++;
        const started = Date.now();
        if (env.PUBLIC_AI_LOG === "true") console.info(JSON.stringify({ event: "public_ai_start", model, messages: input.messages.length, tools: input.tools?.length || 0 }));
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
        res.once("close", () => { if (!res.writableFinished) controller.abort(); });
        try {
          const calls = input.messages.flatMap((m: RecordValue) => m.role === "assistant" ? m.tool_calls || [] : []);
          if (calls.length > 128) throw failure(400, tr("会話が長くなりました。新しい会話を始めてください。"));
          const signatures = await data().read(calls.map((c: RecordValue) => hash(`sig:${session.sid}:${c.id}`)));
          for (let i = 0; i < calls.length; i++) {
            const saved = signatures[i];
            if (!saved || (saved.expiresAt?.toMillis?.() ?? new Date(saved.expiresAt).getTime()) <= now()) throw failure(409, tr("会話の期限が切れました。新しい会話を始めてください。"));
            if (saved.callHash !== callHash(calls[i])) throw failure(400, tr("会話の内容を確認できません。新しい会話を始めてください。"));
            delete calls[i].extra_content;
            if (saved.extra) calls[i].extra_content = saved.extra;
          }
          const expiry = new Date((day + 2) * 86400000);
          await data().charge([
            { id: hash(`global:${day}`), limit: limit("PUBLIC_AI_DAILY_LIMIT", 1000), expiresAt: expiry },
            { id: hash(`ip:${day}:${ip}:${secret}`), limit: limit("PUBLIC_AI_IP_DAILY_LIMIT", 100), expiresAt: expiry },
            { id: hash(`session:${hour}:${session.sid}`), limit: 120, expiresAt: new Date((hour + 2) * 3600000) },
          ]);
          phase = "provider";
          const response = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
            method: "POST", redirect: "error", signal: controller.signal,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model, messages: input.messages, stream: true, max_completion_tokens: 4096, reasoning_effort: reasoning, ...(input.tools?.length ? { tools: input.tools, tool_choice: "auto" } : {}) }),
          });
          if (env.PUBLIC_AI_LOG === "true") console.info(JSON.stringify({ event: "public_ai_headers", status: response.status, ms: Date.now() - started }));
          if (!response.ok || !response.body) { await response.body?.cancel(); throw failure(response.status === 429 ? 429 : 502, tr("Geminiに接続できませんでした。少し待ってからお試しください。")); }
          phase = "stream";
          res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no", "X-Nsdeploy-LLM-Route": "managed-gemini" });
          const decoder = new TextDecoder(), completed = new Map<number, RecordValue>(), indexes = new Map<string, number>();
          let nextIndex = 0;
          let line = "", output = "", total = 0;
          const scan = (text: string) => {
            line += text; if (line.length > 256 * 1024) throw new Error("Provider frame too large");
            const normalized: string[] = [];
            let newline;
            while ((newline = line.indexOf("\n")) >= 0) {
              const part = line.slice(0, newline).trim(); line = line.slice(newline + 1);
              if (!part.startsWith("data:") || part === "data: [DONE]") { normalized.push(part + "\n"); continue; }
              let chunk; try { chunk = JSON.parse(part.slice(5)); } catch { normalized.push(part + "\n"); continue; }
              for (const [position, c] of (chunk.choices?.[0]?.delta?.tool_calls || []).entries()) {
                // Gemini may omit OpenAI's streaming index. Keep parallel calls separate for the unchanged browser runtime.
                let index = c.id && indexes.has(c.id) ? indexes.get(c.id)! : Number.isInteger(c.index) ? c.index : c.id ? nextIndex : position;
                if (c.id && completed.get(index)?.id && completed.get(index)!.id !== c.id) index = nextIndex;
                c.index = index; nextIndex = Math.max(nextIndex, index + 1); if (c.id) indexes.set(c.id, index);
                const item = completed.get(index) || { id: "", function: { name: "", arguments: "" } };
                if (c.id) item.id = c.id;
                if (c.function?.name) item.function.name += c.function.name;
                if (c.function?.arguments) item.function.arguments += c.function.arguments;
                if (c.extra_content) item.extra_content = c.extra_content;
                completed.set(index, item);
              }
              normalized.push(`data: ${JSON.stringify(chunk)}\n`);
            }
            return normalized.join("");
          };
          // Retain a key-sized tail so an upstream error cannot echo credentials across chunks.
          const forward = async (text: string, final = false) => {
            output += text;
            const end = final ? output.length : Math.max(0, output.length - key.length + 1);
            let offset = 0, safe = "";
            while (offset < end) { const found = output.indexOf(key, offset); if (found < 0 || found >= end) { safe += output.slice(offset, end); offset = end; } else { safe += output.slice(offset, found) + "[key]"; offset = found + key.length; } }
            output = output.slice(offset); if (safe && !res.write(safe)) await once(res, "drain", { signal: controller.signal });
          };
          for await (const bytes of response.body as any) { total += bytes.length; if (total > 4 * 1024 * 1024) throw new Error("Provider response too large"); await forward(scan(decoder.decode(bytes, { stream: true }))); }
          const tail = scan(decoder.decode() + "\n");
          phase = "remember";
          await data().write([...completed.values()].filter(c => c.id).map(c => ({ id: hash(`sig:${session.sid}:${c.id}`), value: { extra: c.extra_content || null, callHash: callHash(c), expiresAt: new Date(now() + 7 * 86400000) } })));
          await forward(tail, true); res.end();
        } finally { clearTimeout(timer); controller.abort(); active--; if (env.PUBLIC_AI_LOG === "true") console.info(JSON.stringify({ event: "public_ai_end", phase, finished: res.writableFinished, ms: Date.now() - started })); }
      } catch (error) {
        if (!(error as { status?: number }).status) console.error(JSON.stringify({ event: "public_ai_failure", phase, error: (error as Error).name, at: (error as Error).stack?.split("\n").slice(1, 4).map(line => line.trim()) }));
        if (res.headersSent) res.destroy();
        else json((error as { status?: number }).status || 502, { error: (error as { status?: number }).status ? (error as Error).message : tr("AIの応答を取得できませんでした。少し待ってからお試しください。") });
      }
      return true;
    },
  };
}
