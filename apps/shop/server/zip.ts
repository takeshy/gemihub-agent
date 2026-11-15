import { deflateRawSync } from "node:zlib";

type Entry = { name: string; data: Buffer | string };
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
const crc32 = (bytes: Buffer) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ value >>> 8;
  return (value ^ 0xffffffff) >>> 0;
};
/** One file at a time; file contents do not accumulate in memory while downloading. */
export async function* zip(entries: AsyncIterable<Entry> | Iterable<Entry>) {
  const directory: Buffer[] = [], names = new Set<string>();
  let offset = 0;
  for await (const entry of entries) {
    if (!entry.name || entry.name.startsWith("/") || entry.name.includes("\\") || entry.name.split("/").some(part => !part || part === "." || part === "..") || /[\x00-\x1f]/.test(entry.name) || names.has(entry.name)) throw new Error("Invalid ZIP entry");
    names.add(entry.name);
    const name = Buffer.from(entry.name), original = Buffer.from(entry.data), data = deflateRawSync(original);
    if (name.length > 65535 || directory.length >= 65535 || offset + data.length + name.length + 30 > 0xffffffff) throw new Error("Export exceeds ZIP size limit");
    const checksum = crc32(original), local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(33, 12); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(original.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(33, 14); central.writeUInt32LE(checksum, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(original.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    directory.push(Buffer.concat([central, name])); offset += local.length + name.length + data.length;
    yield local; yield name; yield data;
  }
  const size = directory.reduce((sum, entry) => sum + entry.length, 0);
  if (offset + size > 0xffffffff) throw new Error("Export exceeds ZIP size limit");
  for (const entry of directory) yield entry;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(directory.length, 8); end.writeUInt16LE(directory.length, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  yield end;
}
