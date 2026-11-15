import { randomUUID } from "node:crypto";
import { createApp } from "../../server/app.ts";
import type { Store } from "../../server/store.ts";
import type { TestContext } from "node:test";
import type { StorefrontFiles } from "../../server/storefront-files.ts";
import { Readable } from "node:stream";

type File = { name: string; parents: string[]; content: string; trashed?: boolean };
type Input = { fileId?: string; requestBody?: { id?: string; name?: string; parents?: string[]; trashed?: boolean }; media?: { body: Readable }; alt?: string; addParents?: string; removeParents?: string };
/** In-memory Drive transport exercising the real publication/archive/restore code. */
export function designDrive() {
  const files = new Map<string, File>();
  let failUpdate: ((input: Input) => boolean) | undefined;
  let failCopy = false;
  async function content(input: Input) {
    let text = "";
    if (input.media) for await (const chunk of input.media.body) text += chunk.toString();
    return text;
  }
  const file = (id: string) => {
    const value = files.get(id);
    if (!value || value.trashed) throw Object.assign(new Error("Drive file missing"), { code: 404 });
    return value;
  };
  const fixture = {
    files,
    app(t: TestContext, ...args: Parameters<typeof createApp>) {
      const store = args[0] as Store;
      const put = store.put.bind(store);
      t.mock.method(store, "put", async (kind: string, id: string, value: unknown) => {
        await put(kind, id, value);
        if (kind === "shopFile") {
          const metadata = value as { id: string; name?: string; parents?: string[]; trashed?: boolean };
          const file = files.get(metadata.id);
          if (file) Object.assign(file, { name: metadata.name || "", parents: metadata.parents || [], trashed: metadata.trashed });
        }
      });
      while (args.length < 10) args.push(undefined as never);
      args.push(objects);
      return createApp(...args);
    },
    failNextUpdate(predicate: (input: Input) => boolean) { failUpdate = predicate; },
    failNextCopy() { failCopy = true; },
    client: { files: {
      async create(input: Input) {
        const id = input.requestBody?.id || randomUUID();
        files.set(id, { name: input.requestBody?.name || "", parents: input.requestBody?.parents || [], content: await content(input) });
        return { data: { id } };
      },
      async get(input: Input) {
        const value = file(input.fileId!);
        return { data: input.alt === "media" ? value.content : { parents: value.parents } };
      },
      async copy(input: Input) {
        if (failCopy) { failCopy = false; throw new Error("Drive copy failed"); }
        const id = randomUUID();
        files.set(id, { ...file(input.fileId!), name: input.requestBody?.name || "", parents: input.requestBody?.parents || [] });
        return { data: { id } };
      },
      async update(input: Input) {
        if (failUpdate?.(input)) { failUpdate = undefined; throw new Error("Drive write failed"); }
        const value = file(input.fileId!);
        if (input.media) value.content = await content(input);
        if (input.addParents) value.parents = [input.addParents];
        if (input.requestBody?.trashed) {
          const trash = (id: string) => {
            files.get(id)!.trashed = true;
            for (const [child, entry] of files) if (entry.parents.includes(id)) trash(child);
          };
          trash(input.fileId!);
        }
        return { data: { id: input.fileId } };
      },
    } },
  };
  const objects: StorefrontFiles = {
    async write(path, body) {
      const id = path.split("/").at(-1)!;
      const content = Buffer.from(body).toString("utf8");
      if (failCopy && content.startsWith('{"schemaVersion":2,"design":')) { failCopy = false; throw new Error("Object archive failed"); }
      const media = { body: Readable.from([content]) };
      if (files.has(id)) await fixture.client.files.update({ fileId: id, media });
      else await fixture.client.files.create({ requestBody: { id }, media });
    },
    async read(path) {
      const id = path.split("/").at(-1)!;
      try { return Buffer.from(String((await fixture.client.files.get({ fileId: id, alt: "media" })).data)); }
      catch (error) { if ((error as { code?: number }).code === 404) return undefined; throw error; }
    },
    async remove(path) { await fixture.client.files.update({ fileId: path.split("/").at(-1)!, requestBody: { trashed: true } }); },
  };
  return { ...fixture, objects };
}
