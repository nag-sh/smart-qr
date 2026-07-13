package sh.nag.smartqr;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Native file actions that web apps cannot do from a WebView:
 * - saveFile: opens Android's Storage Access Framework picker so the user can
 *   choose where to save a file (the "Save as" flow).
 * - shareFile: writes a base64 payload to app cache and exposes it via the
 *   FileProvider so the Android share sheet can send it to another app.
 */
@CapacitorPlugin(name = "SaveAs")
public class SaveAsPlugin extends Plugin {

    private static final String TAG = "SmartQRSaveAs";

    @PluginMethod
    public void saveFile(PluginCall call) {
        String filename = call.getString("filename");
        String data = call.getString("data");
        String mimeType = call.getString("mimeType", "application/octet-stream");

        if (filename == null || filename.isEmpty() || data == null || data.isEmpty()) {
            call.reject("filename and data are required");
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(mimeType);
                intent.putExtra(Intent.EXTRA_TITLE, filename);
                startActivityForResult(call, intent, "saveFileResult");
            } catch (Exception e) {
                Log.e(TAG, "Failed to start save dialog", e);
                call.reject("Failed to open save dialog", e);
            }
        });
    }

    @ActivityCallback
    private void saveFileResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            call.reject("User cancelled");
            return;
        }

        Intent data = result.getData();
        if (data == null || data.getData() == null) {
            call.reject("No file selected");
            return;
        }

        Uri uri = data.getData();
        String base64 = call.getString("data");

        try (OutputStream os = getContext().getContentResolver().openOutputStream(uri)) {
            if (os == null) {
                call.reject("Failed to open output stream");
                return;
            }
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            os.write(bytes);
            os.flush();
            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Failed to write file", e);
            call.reject("Failed to write file", e);
        }
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        String filename = call.getString("filename");
        String data = call.getString("data");
        String mimeType = call.getString("mimeType", "application/octet-stream");

        if (filename == null || filename.isEmpty() || data == null || data.isEmpty()) {
            call.reject("filename and data are required");
            return;
        }

        try {
            File cacheDir = new File(getContext().getCacheDir(), "share");
            if (!cacheDir.exists() && !cacheDir.mkdirs()) {
                call.reject("Failed to create cache directory");
                return;
            }

            File file = new File(cacheDir, filename);
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            try (FileOutputStream fos = new FileOutputStream(file)) {
                fos.write(bytes);
                fos.flush();
            }

            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                file
            );

            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType(mimeType);
            shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(shareIntent, "Share " + filename);

            getActivity().runOnUiThread(() -> {
                getActivity().startActivity(chooser);
                call.resolve();
            });
        } catch (Exception e) {
            Log.e(TAG, "Failed to share file", e);
            call.reject("Failed to share file", e);
        }
    }
}
