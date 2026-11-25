'use strict';
/* global Tesseract */
// Lokalne rozpoznawanie tekstu (OCR) skanów i zdjęć orzeczeń – Tesseract (język polski)
// i pdf.js działają w całości na tym urządzeniu. Obrazy NIGDY nie są wysyłane do internetu.
(function () {
  const base = new URL('.', location.href).href;
  const vendor = (p) => new URL('vendor/' + p, base).href;
  let workerPromise = null;
  let pdfjs = null;

  async function getWorker(onProgress) {
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker('pol', 1, {
        workerPath: vendor('tesseract/worker.min.js'),
        corePath: vendor('tesseract/core/'),
        langPath: vendor('tesseract/lang/'),
        workerBlobURL: false,
        cacheMethod: 'none',
        gzip: true,
        logger: (m) => { if (OCR.onProgress && m.status === 'recognizing text') OCR.onProgress(m.progress); }
      }).then(async (w) => {
        await w.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '3' });
        return w;
      }).catch((e) => { workerPromise = null; throw e; });
    }
    if (onProgress) OCR.onProgress = onProgress;
    return workerPromise;
  }

  async function loadPdf() {
    if (!pdfjs) {
      pdfjs = await import(vendor('pdfjs/pdf.min.js'));
      pdfjs.GlobalWorkerOptions.workerSrc = vendor('pdfjs/pdf.worker.min.js');
    }
    return pdfjs;
  }

  async function imageToCanvas(file) {
    let bmp;
    try {
      bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (_) {
      const url = URL.createObjectURL(file);
      try {
        bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`${file.name}: nie mogę otworzyć tego formatu (zdjęcia HEIC zapisz jako JPG).`)); i.src = url; });
      } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    }
    const w = bmp.width || bmp.naturalWidth;
    const h = bmp.height || bmp.naturalHeight;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0);
    return c;
  }

  // plik (zdjęcie lub PDF) → strony jako canvas
  async function fileToPages(file) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) {
      if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|bmp|gif|tiff?)$/i.test(file.name)) throw new Error(`${file.name}: obsługiwane są zdjęcia (JPG, PNG, WEBP) i pliki PDF.`);
      return [await imageToCanvas(file)];
    }
    const lib = await loadPdf();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    const pages = [];
    for (let i = 1; i <= Math.min(doc.numPages, 20); i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 2.2 });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp, canvas: c }).promise;
      pages.push(c);
    }
    return pages;
  }

  // skala szarości, rozciągnięcie kontrastu, rozmiar optymalny dla Tesseracta
  function preprocess(src) {
    const target = 2200;
    const scale = Math.max(0.5, Math.min(2.5, target / Math.max(src.width, src.height)));
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * scale);
    c.height = Math.round(src.height * scale);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) { const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = g; hist[g]++; }
    const total = d.length / 4;
    let lo = 0, hi = 255, acc = 0;
    for (; lo < 255; lo++) { acc += hist[lo]; if (acc > total * 0.01) break; }
    acc = 0;
    for (; hi > 0; hi--) { acc += hist[hi]; if (acc > total * 0.01) break; }
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range)); d[i] = d[i + 1] = d[i + 2] = v; }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function toJpeg(canvas, maxSide, q) {
    const s = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
    const c = document.createElement('canvas');
    c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q || 0.85);
  }

  async function recognize(canvas, onProgress) {
    const w = await getWorker(onProgress);
    const r = await w.recognize(preprocess(canvas));
    return { text: r.data.text || '', confidence: r.data.confidence || 0 };
  }

  const OCR = { fileToPages, recognize, preprocess, toJpeg, onProgress: null, warmUp: () => getWorker().then(() => true) };
  window.OCR = OCR;
})();
