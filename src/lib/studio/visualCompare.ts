export interface PixelData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const grayAt = (image: PixelData, x: number, y: number): number => {
  const sourceX = Math.min(image.width - 1, Math.max(0, Math.round(x)));
  const sourceY = Math.min(image.height - 1, Math.max(0, Math.round(y)));
  const offset = (sourceY * image.width + sourceX) * 4;
  return image.data[offset] * 0.299 + image.data[offset + 1] * 0.587 + image.data[offset + 2] * 0.114;
};

/** A 64-bit difference hash that is stable across modest changes in render size. */
export function visualHash(image: PixelData): string {
  if (image.width <= 0 || image.height <= 0) return '';
  let hash = '';
  for (let row = 0; row < 8; row += 1) {
    const y = ((row + 0.5) * image.height) / 8;
    for (let column = 0; column < 8; column += 1) {
      const left = grayAt(image, ((column + 0.5) * image.width) / 9, y);
      const right = grayAt(image, ((column + 1.5) * image.width) / 9, y);
      hash += left > right ? '1' : '0';
    }
  }
  return hash;
}

export function visualHashSimilarity(left: string | undefined, right: string | undefined): number | null {
  if (!left || !right || left.length !== right.length) return null;
  let same = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) same += 1;
  }
  return same / left.length;
}
