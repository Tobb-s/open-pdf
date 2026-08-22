import { describe, expect, it, vi } from 'vitest';
import { MAX_OCR_PAGES, MAX_STRUCTURAL_BYTES, MAX_FILE_BYTES, yieldToBrowser } from '@/lib/limits';

describe('yieldToBrowser', () => {
  it('does not depend on a timer, which a background tab throttles', async () => {
    // The defect this pins: it used setTimeout(0), and browsers clamp nested
    // timers to about a second in a tab that is not in front — so splitting a
    // 700-page book reached page six in forty-four seconds. With fake timers
    // installed and never advanced, a timer-based yield can never resolve.
    vi.useFakeTimers();
    try {
      let resolved = false;
      const pending = yieldToBrowser().then(() => {
        resolved = true;
      });
      await Promise.race([pending, new Promise((r) => setImmediate(r))]);
      await pending;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves many times in a row without piling up', async () => {
    const started = performance.now();
    for (let i = 0; i < 200; i += 1) await yieldToBrowser();
    // Two hundred yields at the old clamped rate would be over three minutes.
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('ceilings', () => {
  it('lets a book through the tools that only read the page tree', () => {
    expect(MAX_STRUCTURAL_BYTES).toBeGreaterThan(MAX_FILE_BYTES);
  });

  it('no longer turns a whole book away from OCR', () => {
    expect(MAX_OCR_PAGES).toBeGreaterThanOrEqual(500);
  });
});
