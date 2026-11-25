'use strict';
// Kopiuje biblioteki przeglądarkowe do src/renderer/vendor, żeby okno aplikacji działało całkowicie
// lokalnie – bez pobierania czegokolwiek z sieci: OCR (Tesseract + język polski), PDF (pdf.js), font Inter.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const out = path.join(root, 'src', 'renderer', 'vendor');

const files = [
  [nm('tesseract.js', 'dist', 'tesseract.min.js'), 'tesseract/tesseract.min.js'],
  [nm('tesseract.js', 'dist', 'worker.min.js'), 'tesseract/worker.min.js'],
  [nm('tesseract.js-core', 'tesseract-core-lstm.wasm.js'), 'tesseract/core/tesseract-core-lstm.wasm.js'],
  [nm('tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'), 'tesseract/core/tesseract-core-simd-lstm.wasm.js'],
  [nm('tesseract.js-core', 'tesseract-core-relaxedsimd-lstm.wasm.js'), 'tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  [nm('@tesseract.js-data', 'pol', '4.0.0_best_int', 'pol.traineddata.gz'), 'tesseract/lang/pol.traineddata.gz'],
  [nm('pdfjs-dist', 'build', 'pdf.min.mjs'), 'pdfjs/pdf.min.js'],
  [nm('pdfjs-dist', 'build', 'pdf.worker.min.mjs'), 'pdfjs/pdf.worker.min.js'],
  [nm('@fontsource-variable', 'inter', 'files', 'inter-latin-ext-wght-normal.woff2'), 'fonts/inter-latin-ext.woff2'],
  [nm('@fontsource-variable', 'inter', 'files', 'inter-latin-wght-normal.woff2'), 'fonts/inter-latin.woff2']
];

let copied = 0;
const missing = [];
for (const [src, rel] of files) {
  const dst = path.join(out, rel);
  if (!fs.existsSync(src)) { missing.push(path.relative(root, src)); continue; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copied++;
}
console.log(`[copy-vendor] skopiowano ${copied} plików do src/renderer/vendor`);
if (missing.length) {
  console.warn('[copy-vendor] brak plików (uruchom npm install):\n  ' + missing.join('\n  '));
  if (process.env.CI) process.exit(1);
}
