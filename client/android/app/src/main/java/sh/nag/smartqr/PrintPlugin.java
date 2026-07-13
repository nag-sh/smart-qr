package sh.nag.smartqr;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Native bridge for Android print functionality.
 *
 * Android WebViews do not support {@code window.print()}, so this plugin lets
 * the web app trigger the system print dialog via the WebView's own print
 * adapter. It also exposes a way to open the system print settings so users
 * can configure a printer when none is available.
 */
@CapacitorPlugin(name = "Print")
public class PrintPlugin extends Plugin {

    private static final String TAG = "SmartQRPrint";

    @PluginMethod
    public void print(PluginCall call) {
        if (getActivity() == null) {
            Log.e(TAG, "Plugin is not attached to an activity");
            call.reject("Plugin is not attached to an activity");
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                Log.i(TAG, "Starting native print via WebView adapter");
                PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                if (printManager == null) {
                    Log.e(TAG, "PrintManager is null");
                    call.reject("Print service is not available on this device");
                    return;
                }

                PrintDocumentAdapter base = getBridge().getWebView().createPrintDocumentAdapter("Smart QR Label");
                Log.i(TAG, "Created WebView print adapter: " + base);
                // Wrap the adapter so we can notify the web layer when printing
                // actually finishes. Android rasterizes the final page only after
                // the user confirms in the system dialog, so the web app must keep
                // its print DOM alive until onFinish() fires (otherwise the page
                // prints blank).
                PrintDocumentAdapter adapter = new PrintDocumentAdapter() {
                    @Override
                    public void onStart() {
                        base.onStart();
                    }

                    @Override
                    public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes,
                                         CancellationSignal cancellationSignal, LayoutResultCallback callback,
                                         Bundle metadata) {
                        base.onLayout(oldAttributes, newAttributes, cancellationSignal, callback, metadata);
                    }

                    @Override
                    public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
                                        CancellationSignal cancellationSignal, WriteResultCallback callback) {
                        base.onWrite(pages, destination, cancellationSignal, callback);
                    }

                    @Override
                    public void onFinish() {
                        base.onFinish();
                        Log.i(TAG, "Print document finished; clearing web print DOM");
                        notifyListeners("printComplete", new JSObject());
                    }
                };
                String pageSize = call.getString("pageSize", "letter");
                PrintAttributes.MediaSize mediaSize;
                if ("a4".equals(pageSize)) {
                    mediaSize = PrintAttributes.MediaSize.ISO_A4;
                } else {
                    mediaSize = PrintAttributes.MediaSize.NA_LETTER;
                }
                printManager.print("Smart QR Label", adapter, new PrintAttributes.Builder().setMediaSize(mediaSize).build());
                Log.i(TAG, "Print job dispatched to PrintManager");
                call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "Failed to initiate print", e);
                call.reject("Failed to initiate print: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void openPrintSettings(PluginCall call) {
        if (getActivity() == null) {
            Log.e(TAG, "Plugin is not attached to an activity");
            call.reject("Plugin is not attached to an activity");
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                Log.i(TAG, "Opening Android print settings");
                Intent intent = new Intent(Settings.ACTION_PRINT_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(intent);
                Log.i(TAG, "Print settings intent started");
                call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "Failed to open print settings", e);
                call.reject("Failed to open print settings: " + e.getMessage(), e);
            }
        });
    }
}
