import { describe, it, expect, vi } from 'vitest';
import { compressImage } from '../imageCompression';
import imageCompression from 'browser-image-compression';

vi.mock('browser-image-compression', () => ({
  default: vi.fn(async (file, options) => {
    // Simulate compression by returning a smaller Blob
    const size = Math.min(file.size, 16);
    return new Blob(['x'.repeat(size)], { type: file.type });
  }),
}));

describe('compressImage', () => {
  it('returns a smaller Blob than the input', async () => {
    const file = new File(['a'.repeat(100_000)], 'test.jpg', { type: 'image/jpeg' });
    const compressed = await compressImage(file);
    expect(compressed.size).toBeLessThan(file.size);
    expect(compressed.type).toBe('image/jpeg');
  });

  it('applies default options when no overrides are passed', async () => {
    const file = new File(['b'], 'test.jpg', { type: 'image/jpeg' });
    await compressImage(file);
    expect(imageCompression).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        maxSizeMB: 0.25,
        maxWidthOrHeight: 1024,
        useWebWorker: false,
      })
    );
  });

  it('respects per-view maxSizeMB overrides (e.g. AddItem 0.2)', async () => {
    const file = new File(['c'], 'test.jpg', { type: 'image/jpeg' });
    await compressImage(file, { maxSizeMB: 0.2 });
    expect(imageCompression).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ maxSizeMB: 0.2 })
    );
  });

  it('allows overriding maxWidthOrHeight while keeping defaults', async () => {
    const file = new File(['d'], 'test.jpg', { type: 'image/jpeg' });
    await compressImage(file, { maxWidthOrHeight: 512 });
    expect(imageCompression).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ maxSizeMB: 0.25, maxWidthOrHeight: 512, useWebWorker: false })
    );
  });
});
