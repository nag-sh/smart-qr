import { isNative } from '../utils/platform.js';

const BACKUP_FOLDER = 'SmartQR';

function triggerWebDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Save a backup blob to the device. On native platforms the file is written to
 * Documents/SmartQR and the Android share sheet is opened. On web the standard
 * <a download> fallback is used. If the native Filesystem/Share flow fails for
 * any reason (e.g. missing permissions), the web download fallback is used.
 */
export async function saveBackup(blob, filename) {
  if (!isNative()) {
    triggerWebDownload(blob, filename);
    return;
  }

  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');

    await Filesystem.mkdir({
      path: BACKUP_FOLDER,
      directory: Directory.Documents,
      recursive: true
    });

    const base64 = await blobToBase64(blob);
    const result = await Filesystem.writeFile({
      path: `${BACKUP_FOLDER}/${filename}`,
      data: base64,
      directory: Directory.Documents,
      encoding: 'base64',
      recursive: true
    });

    await Share.share({
      files: [result.uri]
    });
  } catch (err) {
    console.error('Native backup save failed, falling back to web download:', err);
    triggerWebDownload(blob, filename);
  }
}

/**
 * Open a file picker and return the selected backup file as both a File object
 * and an ArrayBuffer. Works on web and in the native WebView via a hidden
 * <input type="file">.
 */
export function pickBackup() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.db,.json,.zip';
    input.style.display = 'none';

    input.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (!file) {
        cleanup();
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        cleanup();
        resolve({ file, arrayBuffer: reader.result });
      };
      reader.onerror = () => {
        cleanup();
        reject(reader.error);
      };
      reader.readAsArrayBuffer(file);
    });

    function cleanup() {
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    }

    document.body.appendChild(input);
    input.click();
  });
}
