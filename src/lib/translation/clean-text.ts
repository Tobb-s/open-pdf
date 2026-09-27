/** Remove only introduced prose emphasis, never math operators or source asterisks. */
export function plainCleanText(text: string, source: string) {
  if (/[*=+×÷]/.test(source)) return text;
  return text.replace(/(^|[\s(“"«])\*{1,2}([\p{L}][\p{L}\p{M}\s.,'’()-]{2,})\*{1,2}(?=$|[\s).,;:!?…”"»])/gu, '$1$2');
}
