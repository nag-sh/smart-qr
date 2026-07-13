import { describe, it, expect, beforeAll } from 'vitest';
import {
  slugify,
  planImagePath,
  dataURLToBlob,
  blobToDataURL,
  isImageRef
} from '../services/localImages';

beforeAll(() => {
  if (typeof FileReader === 'undefined') {
    globalThis.FileReader = class FileReader {
      async readAsDataURL(blob) {
        const reader = this;
        const buffer = await blob.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        reader.result = `data:${blob.type};base64,${base64}`;
        if (reader.onload) reader.onload();
      }
    };
  }
});

describe('slugify', () => {
  it('normalizes unicode and replaces non-alphanumeric characters with dashes', () => {
    expect(slugify('Café München', 'fallback')).toBe('cafe-munchen');
  });

  it('returns the fallback for null, undefined, or empty input', () => {
    expect(slugify(null, 'fallback')).toBe('fallback');
    expect(slugify(undefined, 'fallback')).toBe('fallback');
    expect(slugify('!!!', 'fallback')).toBe('fallback');
  });

  it('trims leading and trailing dashes and collapses multiple dashes', () => {
    expect(slugify('--hello--world--', 'fallback')).toBe('hello-world');
    expect(slugify('hello   world', 'fallback')).toBe('hello-world');
  });
});

describe('planImagePath', () => {
  it('returns the base path and records it as used', () => {
    const used = new Set();
    expect(planImagePath('images/a/b.jpg', used)).toBe('images/a/b.jpg');
    expect(used.has('images/a/b.jpg')).toBe(true);
  });

  it('appends -2, -3, ... when the base path is already used', () => {
    const used = new Set(['images/a/b.jpg']);
    expect(planImagePath('images/a/b.jpg', used)).toBe('images/a/b-2.jpg');
    expect(planImagePath('images/a/b.jpg', used)).toBe('images/a/b-3.jpg');
  });
});

describe('dataURLToBlob / blobToDataURL round-trip', () => {
  it('round-trips a tiny transparent PNG', async () => {
    const dataURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const blob = dataURLToBlob(dataURL);
    expect(blob.type).toBe('image/png');
    const back = await blobToDataURL(blob);
    expect(back).toBe(dataURL);
  });
});

describe('isImageRef', () => {
  it('detects img_ references', () => {
    expect(isImageRef('img_123')).toBe(true);
    expect(isImageRef('img_')).toBe(true);
    expect(isImageRef('data:image/png;base64,abc')).toBe(false);
    expect(isImageRef('/uploads/foo.jpg')).toBe(false);
    expect(isImageRef(null)).toBe(false);
    expect(isImageRef('')).toBe(false);
  });
});
