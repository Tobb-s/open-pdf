/** Remove only introduced prose emphasis, never math operators or source asterisks. */
export function plainCleanText(text: string, source: string) {
  if (/[*=+×÷]/.test(source)) return text;
  return text.replace(/(^|[\s(“"«])\*{1,2}([\p{L}][\p{L}\p{M}\s.,'’()-]{2,})\*{1,2}(?=$|[\s).,;:!?…”"»])/gu, '$1$2');
}

/** Scanned physical line wraps are not paragraph breaks. Keep explicit blank-line breaks. */
export function cleanParagraphText(text: string) {
  return text.replace(/\r\n?/g, '\n').replace(/([^\n])\n(?!\n)/g, '$1 ');
}
