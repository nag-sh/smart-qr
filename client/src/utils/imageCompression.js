import imageCompression from 'browser-image-compression';

const DEFAULT_OPTIONS = {
  maxSizeMB: 0.25,
  maxWidthOrHeight: 1024,
  // Disabled: in the Capacitor Android WebView the blob worker never posts
  // back, so the compression promise hangs forever (permanent "Loading item
  // details..." spinner). Main-thread compression is fast enough for the
  // small target sizes used here.
  useWebWorker: false,
};

export async function compressImage(file, opts = {}) {
  const options = {
    ...DEFAULT_OPTIONS,
    ...opts,
  };
  return imageCompression(file, options);
}

export { DEFAULT_OPTIONS };
