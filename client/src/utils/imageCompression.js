import imageCompression from 'browser-image-compression';

const DEFAULT_OPTIONS = {
  maxSizeMB: 0.25,
  maxWidthOrHeight: 1024,
  useWebWorker: true,
};

export async function compressImage(file, opts = {}) {
  const options = {
    ...DEFAULT_OPTIONS,
    ...opts,
  };
  return imageCompression(file, options);
}

export { DEFAULT_OPTIONS };
