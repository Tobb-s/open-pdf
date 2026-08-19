/**
 * Removes a trailing `.pdf`, whatever its case, and only at the end of the name.
 *
 * A plain `name.replace('.pdf', '')` replaces the first occurrence anywhere and
 * misses `.PDF`, which is how `INFORME.PDF` used to come back as a Word file
 * still named `.PDF`.
 */
export function stripPdfExtension(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '');
}

/** `report.pdf` + `_compressed.pdf` → `report_compressed.pdf`, case-insensitively. */
export function derivedFileName(fileName: string, suffix: string): string {
  return `${stripPdfExtension(fileName)}${suffix}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 bytes';
  const units = ['bytes', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${Number(value.toFixed(exponent === 0 ? 0 : 2))} ${units[exponent]}`;
}

/**
 * Saves a blob to disk.
 *
 * The object URL is revoked on a timer rather than on the next line: revoking it
 * synchronously after `click()` is a race that Chrome happens to win and other
 * browsers do not.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
