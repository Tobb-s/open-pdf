/**
 * Copies every third-party asset OpenPDF needs at runtime into `public/vendor/`,
 * so the browser never fetches executable code from a CDN.
 *
 * Runs automatically before `dev` and `build`. Output is gitignored: the files
 * come from `node_modules` (pinned by package-lock.json) or from a one-time
 * download that is cached on disk, so the repository stays small.
 */

import { createHash } from 'node:crypto';
import { mkdir, copyFile, cp, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'public', 'vendor');

/** Files copied straight out of node_modules. */
const COPIES = [
  {
    from: 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
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
 * What every remote file is expected to hash to.
 *
 * This exists because `zetaoffice_latest` is a mutable tag — there is no
 * versioned path; `zetaoffice_25.2`, `_24.8`, `_stable` and `version.txt` are
 * all 404 — and `public/vendor` is gitignored, so every deployment build starts
 * with an empty cache and downloads whatever that URL serves that day. A
 * quarter of a gigabyte of foreign code, running in the tab that holds the
 * reader's document, on the one route that needs `unsafe-eval`.
 *
 * The hash was already being computed and written into `manifest.json`, where
 * nothing ever read it. Comparing it is the whole fix: upgrading the engine
 * becomes a deliberate commit that changes a line here, rather than something
 * that happens on its own between two builds.
 *
 * To take a new version: run `npm run vendor -- --record`, read the diff, and
 * commit it on purpose.
 */
const EXPECTED = {
  'soffice.js': '5143e5354f470b87f86ba272bcfef857bd13e6f07b59666e48a7ccb89643cd77',
  'soffice.wasm': '9ebd9a487e849a24b9c69f843ebdb451709c27b7722c010e36846433474a5bd4',
  'soffice.data': '3dab0a5448e599dccc1b1e69f4f86ea9eb30777c3f1ed7b9c386a5f4163e361c',
  'soffice.data.js.metadata':
    '5d9d909d0b9b38443c0f19704032d0fc12d654f6c9c24c2c3b237739c4848ae3',
  'spa.traineddata.gz': '40be52f97b5d4eb7460073dc1f94cd546b27150333c0bf854ed7e7132db6bceb',
  'eng.traineddata.gz': '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91',
  'fra.traineddata.gz': 'd611139672b3752c7097e671e4a1d9209dfd37f2aeb081ef6487fba3351e9255',
  'deu.traineddata.gz': '306c4280d0cbed46fbff727486bd43b92730181bae80f56941a091f363bdf28b',
  'ita.traineddata.gz': 'f702fcfad297ce028ede3626d1467b67939f23ff23595f9badd54681cf25a4d3',
  'por.traineddata.gz': 'dacebc1386ddaaf8389f81094236cca0d690897cde693d48cbdaa881c86e2b4c',
};

/** `npm run vendor -- --record` prints a fresh table instead of enforcing it. */
const RECORDING = process.argv.includes('--record');
const recorded = {};

/**
 * Refuses a file that is not the one this repository was built against.
 *
 * The cached branch is checked too. A hash that only guards the download leaves
 * a poisoned cache — a `public/vendor` written by an earlier build, or by
 * anything else with access to the disk — trusted forever, which is the case
 * worth guarding against on a machine that has already run this once.
 */
function verify(name, bytes) {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (RECORDING) {
    recorded[name] = actual;
    return actual;
  }

  const expected = EXPECTED[name];
  if (expected === undefined) {
    console.error(`vendor-assets: no expected hash for ${name}. Add one to EXPECTED.`);
    process.exit(1);
  }
  if (actual !== expected) {
    console.error(
      `vendor-assets: ${name} is not the file this repository was built against.\n` +
        `  expected ${expected}\n` +
        `  got      ${actual}\n` +
        '  Nothing was installed. If the upgrade is intended, run\n' +
        '  `npm run vendor -- --record`, read the diff, and commit it.'
    );
    process.exit(1);
  }
  return actual;
}

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
      manifest.push({
        file: to,
        bytes: size,
        source: 'cached',
        sha256: verify(name, await readFile(destination)),
      });
      continue;
    }

    const bytes = await download(`${LOWA_BASE}/${name}`, destination);
    manifest.push({
      file: to,
      bytes: bytes.length,
      source: 'downloaded',
      sha256: verify(name, bytes),
    });
  }

  for (const lang of LANGUAGES) {
    const to = `tesseract/lang/${lang}.traineddata.gz`;
    const destination = join(vendor, to);

    const leaf = `${lang}.traineddata.gz`;

    if (await exists(destination)) {
      const { size } = await stat(destination);
      manifest.push({
        file: to,
        bytes: size,
        source: 'cached',
        sha256: verify(leaf, await readFile(destination)),
      });
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
      sha256: verify(leaf, bytes),
    });
  }

  await writeFile(
    join(vendor, 'manifest.json'),
    `${JSON.stringify({ generatedBy: 'scripts/vendor-assets.mjs', files: manifest }, null, 2)}\n`
  );

  if (RECORDING) {
    console.log('vendor-assets: recorded hashes — paste into EXPECTED:\n');
    for (const [name, hash] of Object.entries(recorded)) {
      console.log(`  '${name}': '${hash}',`);
    }
    console.log('');
  }

  const total = manifest.reduce((sum, entry) => sum + entry.bytes, 0);
  console.log(
    `vendor-assets: ${manifest.length} files in public/vendor (${(total / 1024 / 1024).toFixed(1)} MB)`
  );
}

main().catch((error) => {
  console.error(`vendor-assets failed: ${error.message}`);
  process.exit(1);
});
