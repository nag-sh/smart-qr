import { describe, it, expect, vi, beforeAll } from 'vitest';
import { compressImage, DEFAULT_OPTIONS } from '../imageCompression';

// jsdom has no real image decoding and no object-URL image loading, so provide
// a minimal bitmap. This exercises the primary (createImageBitmap) path without
// hitting the 8s object-URL fallback timeout that only matters on unsupported
// runtimes. The contract under test: compressImage always resolves to a Blob
// and never throws or hangs.
beforeAll(() => {
  globalThis.createImageBitmap = vi.fn(async () => ({
    width: 100,
    height: 100,
    close: () => {},
  }));
});

describe('compressImage', () => {
  const makeFile = () =>
    new File(['x'.repeat(4096)], 'test.jpg', { type: 'image/jpeg' });

  it('resolves to a Blob and never throws (falls back to the original when canvas is unavailable)', async () => {
    const file = makeFile();
    const result = await compressImage(file);
    expect(result).toBeInstanceOf(Blob);
  });

  it('resolves when given a per-view override (e.g. Add Item maxSizeMB 0.2)', async () => {
    const file = makeFile();
    const result = await compressImage(file, { maxSizeMB: 0.2 });
    expect(result).toBeInstanceOf(Blob);
  });

  it('exposes sensible default options', () => {
    expect(DEFAULT_OPTIONS.maxSizeMB).toBeGreaterThan(0);
    expect(DEFAULT_OPTIONS.maxWidthOrHeight).toBeGreaterThan(0);
  });
});
