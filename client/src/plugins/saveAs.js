import { registerPlugin } from '@capacitor/core';

/**
 * Native file action plugin:
 * - saveFile: Android Storage Access Framework "Save as" picker.
 * - shareFile: Android share sheet for a base64-encoded file.
 *
 * On web, saveFile falls back to the standard <a download> flow and shareFile
 * is not supported.
 */
export const SaveAs = registerPlugin('SaveAs', {
  web: () => ({
    async saveFile({ filename, data, mimeType }) {
      const byteCharacters = atob(data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { uri: null };
    },
    async shareFile() {
      throw new Error('Sharing files is not supported in the browser.');
    }
  })
});
