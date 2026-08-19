/**
 * Copies every third-party asset OpenPDF needs at runtime into `public/vendor/`,
 * so the browser never fetches executable code from a CDN.
 *
 * Runs automatically before `dev` and `build`. Output is gitignored: the files
 * come from `node_modules` (pinned by package-lock.json) or from a one-time
 * download that is cached on disk, so the repository stays small.
 */

import { createHash } from 'node:crypto';
import { mkdir, copyFile, cp, readdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'public', 'vendor');

/** Files copied straight out of node_modules. */
const COPIES = [
  {
    from: 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
    to: 'pdfjs/pdf.worker.min.mjs',
  },
  {
    from: 'node_modules/tesseract.js/dist/worker.min.js',
    to: 'tesseract/worker.min.js',
  },
  // The three LSTM builds of the OCR engine. tesseract.js picks one at runtime
  // based on the SIMD support it detects, so all three have to be available.
  ...['', '-simd', '-relaxedsimd'].map((variant) => ({
    from: `node_modules/tesseract.js-core/tesseract-core${variant}-lstm.wasm.js`,
    to: `tesseract/core/tesseract-core${variant}-lstm.wasm.js`,
  })),
  // zetajs drives LibreOffice from JavaScript. It resolves its sibling `zeta.js`
  // from its own `import.meta.url`, so both files have to be served as static
  // assets rather than bundled.
  { from: 'node_modules/zetajs/source/zeta.js', to: 'lowa/zetajs/zeta.js' },
  { from: 'node_modules/zetajs/source/zetaHelper.js', to: 'lowa/zetajs/zetaHelper.js' },
  // Our own worker code. It lives in scripts/ so it is versioned, and is copied
  // here because zetajs loads it by URL from inside the worker.
  { from: 'scripts/lowa/office_thread.js', to: 'lowa/office_thread.js' },
];

/**
 * The LibreOffice WebAssembly build (LOWA), which converts Office documents to
 * PDF with the fidelity of the desktop application. Around 51 MB, downloaded
 * once and cached on disk; the browser only fetches it when a reader explicitly
 * asks for the converter.
 */
const LOWA_BASE = 'https://cdn.zetaoffice.net/zetaoffice_latest';
const LOWA_FILES = ['soffice.js', 'soffice.wasm', 'soffice.data', 'soffice.data.js.metadata'];

/**
 * Directories pdf.js fetches on demand. Without them it silently falls back to
 * substitute glyphs on CJK documents and cannot decode JPEG 2000 images.
 */
const DIRECTORIES = [
  { from: 'node_modules/pdfjs-dist/cmaps', to: 'pdfjs/cmaps' },
  { from: 'node_modules/pdfjs-dist/standard_fonts', to: 'pdfjs/standard_fonts' },
  { from: 'node_modules/pdfjs-dist/wasm', to: 'pdfjs/wasm' },
  { from: 'node_modules/pdfjs-dist/iccs', to: 'pdfjs/iccs' },
];

/**
 * Tesseract language models. Not shipped inside any npm package, so they are
 * downloaded once and left in place; later builds reuse them.
 */
const LANGUAGES = ['spa', 'eng', 'fra', 'deu', 'ita', 'por'];
const LANG_BASE = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data';
const LANG_TAG = '4.0.0_best_int'; // matches OEM.LSTM_ONLY, which is what the app requests

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, destination, attempt = 1) {
  const response = await fetch(url).catch((error) => ({ ok: false, error }));

  if (!response.ok) {
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      return download(url, destination, attempt + 1);
    }
    throw new Error(
      `Could not download ${url} after ${attempt} attempts` +
        (response.status ? ` (HTTP ${response.status})` : '')
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  return bytes;
}

async function main() {
  const manifest = [];

  for (const { from, to } of COPIES) {
    const source = join(root, from);
    const destination = join(vendor, to);

    if (!(await exists(source))) {
      throw new Error(`Missing ${from}. Run \`npm ci\` before building.`);
    }

    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    const { size } = await stat(destination);
    manifest.push({ file: to, bytes: size, source: 'node_modules' });
  }

  for (const { from, to } of DIRECTORIES) {
    const source = join(root, from);
    const destination = join(vendor, to);

    if (!(await exists(source))) {
      throw new Error(`Missing ${from}. Run \`npm ci\` before building.`);
    }

    await cp(source, destination, { recursive: true });
    const entries = await readdir(destination);
    manifest.push({ file: `${to}/`, files: entries.length, bytes: 0, source: 'node_modules' });
  }

  for (const name of LOWA_FILES) {
    const to = `lowa/${name}`;
    const destination = join(vendor, to);

    if (await exists(destination)) {
      const { size } = await stat(destination);
      manifest.push({ file: to, bytes: size, source: 'cached' });
      continue;
    }

    const bytes = await download(`${LOWA_BASE}/${name}`, destination);
    manifest.push({
      file: to,
      bytes: bytes.length,
      source: 'downloaded',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }

  for (const lang of LANGUAGES) {
    const to = `tesseract/lang/${lang}.traineddata.gz`;
    const destination = join(vendor, to);

    if (await exists(destination)) {
      const { size } = await stat(destination);
      manifest.push({ file: to, bytes: size, source: 'cached' });
      continue;
    }

    const bytes = await download(
      `${LANG_BASE}/${lang}/${LANG_TAG}/${lang}.traineddata.gz`,
      destination
    );
    manifest.push({
      file: to,
      bytes: bytes.length,
      source: 'downloaded',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }

  await writeFile(
    join(vendor, 'manifest.json'),
    `${JSON.stringify({ generatedBy: 'scripts/vendor-assets.mjs', files: manifest }, null, 2)}\n`
  );

  const total = manifest.reduce((sum, entry) => sum + entry.bytes, 0);
  console.log(
    `vendor-assets: ${manifest.length} files in public/vendor (${(total / 1024 / 1024).toFixed(1)} MB)`
  );
}

main().catch((error) => {
  console.error(`vendor-assets failed: ${error.message}`);
  process.exit(1);
});
