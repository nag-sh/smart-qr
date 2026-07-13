import { isNative } from '../utils/platform.js';
import { SaveAs } from '../plugins/saveAs.js';

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
 * Save a backup blob to the device using the native "Save as" picker on Android,
 * or the standard <a download> fallback on web.
 */
export async function saveBackup(blob, filename, mimeType = 'application/zip') {
  const base64 = await blobToBase64(blob);
  if (!isNative()) {
    triggerWebDownload(blob, filename);
    return;
  }

  try {
    await SaveAs.saveFile({ filename, data: base64, mimeType });
  } catch (err) {
    console.error('Native save-as failed, falling back to web download:', err);
    triggerWebDownload(blob, filename);
  }
}

/**
 * Share a backup blob via the native Android share sheet.
 */
export async function shareBackup(blob, filename, mimeType = 'application/zip') {
  if (!isNative()) {
    alert('Sharing files is not available in the browser.');
    return;
  }

  const base64 = await blobToBase64(blob);
  try {
    await SaveAs.shareFile({ filename, data: base64, mimeType });
  } catch (err) {
    console.error('Native share failed:', err);
    alert('Failed to share backup: ' + (err?.message || 'Unknown error'));
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
