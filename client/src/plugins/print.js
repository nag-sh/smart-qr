import { registerPlugin } from '@capacitor/core';

/**
 * Custom Capacitor plugin that bridges the web app to native print actions.
 *
 * On Android, WebViews do not support window.print(), so the native side uses
 * the WebView's createPrintDocumentAdapter() to render the existing print
 * media stylesheet. openPrintSettings() opens android.settings.PRINT_SETTINGS
 * when the user needs to configure a printer.
 */
export const Print = registerPlugin('Print');
