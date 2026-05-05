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

const USER_CONFIG_KEY = 'config::user';

export async function getUserConfig() {
  return (await get(USER_CONFIG_KEY)) || {};
}

export async function setUserConfig(patch) {
  const current = await getUserConfig();
  const merged = { ...current, ...patch };
  await set(USER_CONFIG_KEY, merged);
  return merged;
}

export async function clearUserConfig() {
  await del(USER_CONFIG_KEY);
}

const AUDIO_PREFIX = 'audio::';
const AUDIO_INDEX_KEY = 'audio::__index__';
const AUDIO_LIMIT = 200; // cap LRU at 200 audio blobs

export async function getAudioBlob(key) {
  const blob = await get(AUDIO_PREFIX + key);
  if (!(blob instanceof Blob)) return null;
  // Touch index for LRU on read
  await touchAudioIndex(key);
  return blob;
}

export async function putAudioBlob(key, blob) {
  await set(AUDIO_PREFIX + key, blob);
  await touchAudioIndex(key);
  await evictAudioIfOverLimit();
}

async function touchAudioIndex(key) {
  const idx = (await get(AUDIO_INDEX_KEY)) || [];
  const existing = idx.findIndex(e => e.key === key);
  const now = Date.now();
  if (existing >= 0) idx.splice(existing, 1);
  idx.push({ key, ts: now });
  await set(AUDIO_INDEX_KEY, idx);
}

async function evictAudioIfOverLimit() {
  const idx = (await get(AUDIO_INDEX_KEY)) || [];
  if (idx.length <= AUDIO_LIMIT) return;
  const toEvict = idx.slice(0, idx.length - AUDIO_LIMIT);
  for (const e of toEvict) {
    try { await del(AUDIO_PREFIX + e.key); } catch {}
  }
  await set(AUDIO_INDEX_KEY, idx.slice(idx.length - AUDIO_LIMIT));
}

export async function audioCacheKey(provider, voice, lang, text) {
  // SHA-256 hex of (provider/voice/lang/text), first 16 hex = 64 bit; collision
  // probability for a few hundred entries is negligible.
  const enc = new TextEncoder().encode(`${provider}::${voice}::${lang}::${text}`);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf).slice(0, 16))
    .map(b => b.toString(16).padStart(2, '0')).join('');
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
