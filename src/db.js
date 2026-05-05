import { get, set, del, keys } from 'idb-keyval';

const PDF_PREFIX = 'pdf::';
const EXPLAIN_PREFIX = 'explain::';
const TRANS_PREFIX = 'trans::';
const PDF_LIMIT = 5;

export async function getDocHash(arrayBuffer) {
  const slice = arrayBuffer.byteLength > 65536
    ? arrayBuffer.slice(0, 65536)
    : arrayBuffer;
  const buf = await crypto.subtle.digest('SHA-256', slice);
  return Array.from(new Uint8Array(buf).slice(0, 8))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function putPdf(record) {
  // record: { docHash, name, size, blob, thumbnail, addedAt?, lastOpenedAt }
  const key = PDF_PREFIX + record.docHash;
  const existing = await get(key);
  const merged = {
    ...record,
    addedAt: existing?.addedAt || Date.now(),
    lastOpenedAt: record.lastOpenedAt || Date.now()
  };
  await set(key, merged);
  await evictIfOverLimit();
  return merged;
}

export async function touchPdf(docHash) {
  const key = PDF_PREFIX + docHash;
  const rec = await get(key);
  if (!rec) return;
  rec.lastOpenedAt = Date.now();
  await set(key, rec);
}

export async function getPdf(docHash) {
  return get(PDF_PREFIX + docHash);
}

export async function deletePdf(docHash) {
  await del(PDF_PREFIX + docHash);
}

export async function listPdfs() {
  const allKeys = await keys();
  const pdfKeys = allKeys.filter(k => typeof k === 'string' && k.startsWith(PDF_PREFIX));
  const records = await Promise.all(pdfKeys.map(k => get(k)));
  return records
    .filter(Boolean)
    .sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));
}

async function evictIfOverLimit() {
  const list = await listPdfs();
  if (list.length <= PDF_LIMIT) return;
  const toEvict = list.slice(PDF_LIMIT);
  for (const r of toEvict) {
    await del(PDF_PREFIX + r.docHash);
  }
}

export async function getExplain(docHash, phrase, lang) {
  const key = `${EXPLAIN_PREFIX}${docHash}::${normalize(phrase)}::${lang}`;
  return get(key);
}

export async function putExplain(docHash, phrase, lang, payload) {
  const key = `${EXPLAIN_PREFIX}${docHash}::${normalize(phrase)}::${lang}`;
  await set(key, payload);
}

function normalize(s) {
  return s.trim().toLowerCase().slice(0, 200);
}

export async function getTrans(docHash, segId, lang) {
  return get(`${TRANS_PREFIX}${docHash}::${segId}::${lang}`);
}

export async function putTrans(docHash, segId, lang, text) {
  await set(`${TRANS_PREFIX}${docHash}::${segId}::${lang}`, text);
}
