import { renderPdf, renderThumbnail } from './pdf-viewer.js';
import { putPdf, touchPdf, getDocHash } from './db.js';

/**
 * Open a PDF from a File or Blob: hash, render, persist to IDB.
 * Returns { docHash, hasTextLayer }.
 */
export async function openPdfFile(file, viewerEl, onStatus = () => {}) {
  if (!file) throw new Error('No file');
  if (!isPdf(file)) throw new Error('Only PDF files are supported');

  onStatus('Reading file…');
  const arrayBuffer = await file.arrayBuffer();
  const docHash = await getDocHash(arrayBuffer);

  onStatus('Rendering PDF…');
  const data = new Uint8Array(arrayBuffer);
  const dataForRender = data.slice();
  const dataForThumb = data.slice();
  const dataForBlob = data.slice();
  const { hasTextLayer } = await renderPdf(dataForRender, viewerEl);

  onStatus('Generating thumbnail…');
  let thumbnail = null;
  try {
    thumbnail = await renderThumbnail(dataForThumb, 200);
  } catch (e) {
    console.warn('Thumbnail failed:', e);
  }

  onStatus('Saving to history…');
  try {
    await putPdf({
      docHash,
      name: file.name || 'Untitled.pdf',
      size: file.size || arrayBuffer.byteLength,
      blob: new Blob([dataForBlob], { type: 'application/pdf' }),
      thumbnail,
      lastOpenedAt: Date.now()
    });
  } catch (e) {
    console.warn('IDB write failed (continuing without persistence):', e);
  }

  onStatus('');
  return { docHash, hasTextLayer };
}

/**
 * Open a PDF previously stored in IDB (clicked from History).
 */
export async function openPdfFromRecord(record, viewerEl, onStatus = () => {}) {
  onStatus('Loading from history…');
  const arrayBuffer = await record.blob.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);
  const { hasTextLayer } = await renderPdf(data, viewerEl);
  await touchPdf(record.docHash);
  onStatus('');
  return { docHash: record.docHash, hasTextLayer };
}

/**
 * Wire drag/drop and file-picker UI to a callback that receives a File.
 */
export function wireUploadUI({ pickButton, fileInput, dropZone, onFile }) {
  pickButton?.addEventListener('click', () => fileInput.click());
  fileInput?.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) onFile(f);
    fileInput.value = '';
  });

  if (!dropZone) return;
  let dragDepth = 0;

  const onDragEnter = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    dropZone.classList.add('drop-zone-active');
  };
  const onDragOver = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropZone.classList.remove('drop-zone-active');
  };
  const onDrop = (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropZone.classList.remove('drop-zone-active');
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  };

  window.addEventListener('dragenter', onDragEnter);
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('dragleave', onDragLeave);
  window.addEventListener('drop', onDrop);
}

function hasFiles(e) {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes('Files');
}

function isPdf(file) {
  if (file.type === 'application/pdf') return true;
  return /\.pdf$/i.test(file.name || '');
}
