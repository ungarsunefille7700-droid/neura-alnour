// ZIP reader that works IN THE BROWSER, piece by piece: the archive is never loaded whole
// into memory (only its directory, then the files actually read, one at a time). Nothing is
// sent to a server. Protections: dangerous paths flagged, encrypted files skipped,
// suspicious compression ratios (ZIP bombs) and oversized files refused before reading.

export const ZIP_LIMITS = {
  maxEntries: 200000,
  maxReadBytes: 2 * 1024 * 1024, // one file read in depth: at most 2 MB once decompressed
  maxRatio: 200, // a file 200 times bigger than its compressed size is a likely ZIP bomb
};

const EOCD = 0x06054b50;
const EOCD64_LOCATOR = 0x07064b50;
const EOCD64 = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const readSlice = async (blob, start, end) => {
  const part = blob.slice(start, end);
  if (part.arrayBuffer) return new Uint8Array(await part.arrayBuffer());
  return new Uint8Array(await new Response(part).arrayBuffer());
};

const u16 = (view, at) => view.getUint16(at, true);
const u32 = (view, at) => view.getUint32(at, true);
const u64 = (view, at) => Number(view.getBigUint64(at, true));

const decodeName = (bytes, utf8) => {
  try {
    return new TextDecoder(utf8 ? 'utf-8' : 'utf-8', { fatal: false }).decode(bytes);
  } catch {
    return String.fromCharCode(...bytes);
  }
};

// A path that would land outside the project folder once extracted.
export const unsafePath = (name) => /^([a-z]:|\/|\\)/i.test(name) || /(^|[\\/])\.\.([\\/]|$)/.test(name);

// The archive's directory: every file with its sizes, without decompressing anything.
export async function readZipDirectory(blob) {
  const size = blob.size;
  const tailLength = Math.min(size, 65557 + 22);
  const tail = await readSlice(blob, size - tailLength, size);
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (u32(tailView, i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Ce fichier n'est pas une archive ZIP valide.");
  let count = u16(tailView, eocd + 10);
  let dirSize = u32(tailView, eocd + 12);
  let dirOffset = u32(tailView, eocd + 16);
  // ZIP64 (big archives or many files).
  if ((count === 0xffff || dirOffset === 0xffffffff) && eocd >= 20 && u32(tailView, eocd - 20) === EOCD64_LOCATOR) {
    const recordOffset = u64(tailView, eocd - 12);
    const record = await readSlice(blob, recordOffset, recordOffset + 56);
    const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
    if (u32(view, 0) === EOCD64) {
      count = u64(view, 32);
      dirSize = u64(view, 40);
      dirOffset = u64(view, 48);
    }
  }
  if (count > ZIP_LIMITS.maxEntries) throw new Error(`Archive refusée : ${count} fichiers (maximum ${ZIP_LIMITS.maxEntries}).`);
  const dir = await readSlice(blob, dirOffset, dirOffset + dirSize);
  const view = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const entries = [];
  let at = 0;
  while (at + 46 <= dir.length && u32(view, at) === CENTRAL) {
    const flags = u16(view, at + 8);
    const method = u16(view, at + 10);
    let compressed = u32(view, at + 20);
    let uncompressed = u32(view, at + 24);
    const nameLength = u16(view, at + 28);
    const extraLength = u16(view, at + 30);
    const commentLength = u16(view, at + 32);
    let offset = u32(view, at + 42);
    const name = decodeName(dir.subarray(at + 46, at + 46 + nameLength), Boolean(flags & 0x800));
    // ZIP64 sizes / offset live in the extra field.
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = u16(view, extra);
      const length = u16(view, extra + 2);
      if (id === 0x0001) {
        let field = extra + 4;
        if (uncompressed === 0xffffffff) { uncompressed = u64(view, field); field += 8; }
        if (compressed === 0xffffffff) { compressed = u64(view, field); field += 8; }
        if (offset === 0xffffffff) { offset = u64(view, field); }
      }
      extra += 4 + length;
    }
    if (!name.endsWith('/')) {
      entries.push({
        index: entries.length,
        path: name.replace(/\\/g, '/'),
        size: uncompressed,
        compressedSize: compressed,
        method,
        offset,
        encrypted: Boolean(flags & 0x1),
        unsafe: unsafePath(name),
        // A damaged archive: unreadable name or data outside the file.
        corrupt: /[\u0000-\u001f\ufffd]/.test(name) || offset + 30 > blob.size || compressed > blob.size,
      });
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// Why a file is not read in depth (null: it can be read).
export const refusalReason = (entry) => {
  if (entry.corrupt) return 'entrée corrompue dans l’archive';
  if (entry.unsafe) return 'chemin dangereux (sortirait du dossier du projet)';
  if (entry.encrypted) return 'fichier chiffré';
  if (entry.method !== 0 && entry.method !== 8) return `compression non prise en charge (méthode ${entry.method})`;
  if (entry.size > ZIP_LIMITS.maxReadBytes) return `trop gros pour être lu en entier (${Math.round(entry.size / 1024)} Ko)`;
  if (entry.compressedSize > 0 && entry.size / entry.compressedSize > ZIP_LIMITS.maxRatio && entry.size > 1024 * 1024) {
    return 'taux de compression suspect (archive piégée possible)';
  }
  return null;
};

const inflate = async (bytes) => {
  if (typeof DecompressionStream === 'undefined') throw new Error('Décompression non disponible dans ce navigateur.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > ZIP_LIMITS.maxReadBytes * 2) { reader.cancel(); throw new Error('décompression arrêtée : taille réelle supérieure à celle annoncée'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let pos = 0;
  chunks.forEach((chunk) => { out.set(chunk, pos); pos += chunk.length; });
  return out;
};

// The bytes of one file (decompressed), read from the archive on demand.
export async function readZipEntry(blob, entry) {
  const reason = refusalReason(entry);
  if (reason) throw new Error(reason);
  if (entry.offset + 30 > blob.size) throw new Error('entrée corrompue dans l’archive');
  const head = await readSlice(blob, entry.offset, entry.offset + 30);
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (u32(view, 0) !== LOCAL) throw new Error('en-tête de fichier invalide');
  const start = entry.offset + 30 + u16(view, 26) + u16(view, 28);
  if (start + entry.compressedSize > blob.size) throw new Error('entrée corrompue dans l’archive');
  const raw = await readSlice(blob, start, start + entry.compressedSize);
  return entry.method === 0 ? raw : inflate(raw);
}

export async function readZipText(blob, entry) {
  const bytes = await readZipEntry(blob, entry);
  if (bytes.subarray(0, 8000).includes(0)) throw new Error('fichier binaire');
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
