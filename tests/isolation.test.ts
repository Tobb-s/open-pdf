import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearIsolationRetry, isolationStatus, reloadForIsolation } from '@/lib/office';

/**
 * Cross-origin isolation is granted by headers on the document response, so a
 * page reached by a client-side navigation never gets it. These cover the
 * recovery: reload once, and only once.
 */

const store = new Map<string, string>();
const reload = vi.fn();

beforeEach(() => {
  store.clear();
  reload.mockClear();

  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('SharedArrayBuffer', ArrayBuffer);
});

afterEach(() => vi.unstubAllGlobals());

const setIsolated = (value: boolean) => vi.stubGlobal('crossOriginIsolated', value);

describe('isolationStatus', () => {
  it('is ready when the browser granted isolation', () => {
    setIsolated(true);
    expect(isolationStatus()).toBe('ready');
  });

  it('asks for a retry the first time isolation is missing', () => {
    setIsolated(false);
    expect(isolationStatus()).toBe('retrying');
  });

  it('calls it unsupported once a reload has already been tried', () => {
    setIsolated(false);
    reloadForIsolation();
    expect(isolationStatus()).toBe('unsupported');
  });

  it('treats storage it cannot use as unsupported rather than looping', () => {
    setIsolated(false);
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {},
    });
    expect(isolationStatus()).toBe('unsupported');
  });
});

describe('reloadForIsolation', () => {
  it('reloads once and never again', () => {
    setIsolated(false);
    reloadForIsolation();
    reloadForIsolation();
    reloadForIsolation();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {},
    });
    reloadForIsolation();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('clearIsolationRetry', () => {
  it('lets a later visit try again once isolation works', () => {
    setIsolated(false);
    reloadForIsolation();
    expect(isolationStatus()).toBe('unsupported');

    setIsolated(true);
    clearIsolationRetry();

    setIsolated(false);
    expect(isolationStatus()).toBe('retrying');
  });
});
