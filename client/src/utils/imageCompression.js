// Dependency-free image compressor for the Add Item / snap -> details flow.
//
// Why not browser-image-compression: it loads the source via `new Image()` +
// `URL.createObjectURL(file)` and waits for `onload`. In the Capacitor Android
// WebView `Image.onload` never fires for blob/object URLs, so the promise never
// settles and the item-details screen hangs on "Loading item details..." forever.
// createImageBitmap() decodes a Blob/File directly (no Image element, no object
// URL) and is reliable in the Chromium-based WebView. Timeouts + a fallback to
// the original file guarantee this can never hang the UI.

const DEFAULT_OPTIONS = {
  maxSizeMB: 0.25,
  maxWidthOrHeight: 1024,
};

// Resolve with `fallback` if `promise` does not settle within `ms`. Never rejects.
function withTimeout(promise, ms, fallback) {
  let settled = false;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      }
    );
  });
}

function loadBitmap(source) {
  if (typeof createImageBitmap === 'function') {
    // Guarded by the timeout: in some WebViews createImageBitmap never settles,
    // which would hang the caller forever. Bounded so it can't.
    return withTimeout(createImageBitmap(source), 8000, null).then((bmp) => {
      if (!bmp) throw new Error('createImageBitmap timed out');
      return bmp;
    });
  }
  // Fallback for environments without createImageBitmap: an Image element with
  // an object URL. Guarded so a missing onload can never hang the caller.
  return withTimeout(
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(source);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    }),
    8000,
    null
  ).then((img) => {
    if (!img) throw new Error('Image load timed out');
    return img;
  });
}

function canvasToBlob(canvas, type, quality) {
  return withTimeout(
    new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality)),
    8000,
    null
  );
}

export async function compressImage(file, opts = {}) {
  const maxSizeMB = opts.maxSizeMB ?? DEFAULT_OPTIONS.maxSizeMB;
  const maxWidthOrHeight = opts.maxWidthOrHeight ?? DEFAULT_OPTIONS.maxWidthOrHeight;

  try {
    const bitmap = await loadBitmap(file);
    if (!bitmap || !bitmap.width || !bitmap.height) return file;

    const scale = Math.min(1, maxWidthOrHeight / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    if (typeof bitmap.close === 'function') bitmap.close();

    // Quality tuned to roughly hit the target size; the exact byte size is not
    // critical, only that the result is a reasonable JPEG.
    const quality = maxSizeMB >= 1 ? 0.92 : 0.8;
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (blob && blob.size > 0) return blob;
    return file;
  } catch (err) {
    console.warn('compressImage fell back to original file:', err);
    return file;
  }
}

export { DEFAULT_OPTIONS };
