import { Capacitor } from '@capacitor/core';
import { SaveAs } from '../plugins/saveAs.js';
import { blobToDataURL } from './localImages.js';

/**
 * Save a backup blob to the device using the native "Save as" picker on Android,
 * or the standard <a download> fallback on web.
 */
export async function saveBackup(blob, filename, mimeType = 'application/zip') {
  const base64 = (await blobToDataURL(blob)).split(',')[1];
  try {
    await SaveAs.saveFile({ filename, data: base64, mimeType });
  } catch (err) {
    console.error('Save backup failed:', err);
  }
}

/**
 * Share a backup blob via the native Android share sheet.
 */
export async function shareBackup(blob, filename, mimeType = 'application/zip') {
  if (!Capacitor.isNativePlatform()) {
    alert('Sharing files is not available in the browser.');
    return;
  }

  const base64 = (await blobToDataURL(blob)).split(',')[1];
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
