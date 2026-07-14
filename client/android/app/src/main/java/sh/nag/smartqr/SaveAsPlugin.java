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

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
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
        String path = call.getString("path");
        String mimeType = call.getString("mimeType", "application/octet-stream");

        if (filename == null || filename.isEmpty()) {
            call.reject("filename is required");
            return;
        }

        // Stage the payload to a cache file so we never persist the (potentially
        // large) base64 in the saved instance state. Capacitor serializes the
        // whole PluginCall into onSaveInstanceState, and a large base64 blob
        // blows the Binder transaction limit, crashing with
        // TransactionTooLargeException when the Storage Access Framework picker
        // takes the foreground.
        String sourcePath;
        try {
            if (data != null && !data.isEmpty()) {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                sourcePath = stageFile(filename, bytes);
                // Drop the giant base64 from the call; keep only the small path.
                call.getData().remove("data");
                call.getData().put("path", sourcePath);
            } else if (path != null && !path.isEmpty()) {
                sourcePath = path;
            } else {
                call.reject("data or path is required");
                return;
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to stage file", e);
            call.reject("Failed to stage file", e);
            return;
        }

        final String finalMime = mimeType;
        final String finalSource = sourcePath;
        getActivity().runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(finalMime);
                intent.putExtra(Intent.EXTRA_TITLE, filename);
                startActivityForResult(call, intent, "saveFileResult");
            } catch (Exception e) {
                Log.e(TAG, "Failed to start save dialog", e);
                cleanupStagedFile(finalSource);
                call.reject("Failed to open save dialog", e);
            }
        });
    }

    @ActivityCallback
    private void saveFileResult(PluginCall call, ActivityResult result) {
        String sourcePath = call.getString("path");

        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            cleanupStagedFile(sourcePath);
            call.reject("User cancelled");
            return;
        }

        Intent data = result.getData();
        if (data == null || data.getData() == null) {
            cleanupStagedFile(sourcePath);
            call.reject("No file selected");
            return;
        }

        Uri uri = data.getData();

        try (OutputStream os = getContext().getContentResolver().openOutputStream(uri)) {
            if (os == null) {
                cleanupStagedFile(sourcePath);
                call.reject("Failed to open output stream");
                return;
            }
            byte[] bytes = readAllBytes(sourcePath);
            os.write(bytes);
            os.flush();
            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Failed to write file", e);
            call.reject("Failed to write file", e);
        } finally {
            cleanupStagedFile(sourcePath);
        }
    }

    private String stageFile(String filename, byte[] bytes) throws IOException {
        File dir = new File(getContext().getCacheDir(), "saveas");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Failed to create cache directory");
        }
        File file = new File(dir, System.currentTimeMillis() + "_" + sanitize(filename));
        try (FileOutputStream fos = new FileOutputStream(file)) {
            fos.write(bytes);
            fos.flush();
        }
        return file.getAbsolutePath();
    }

    private byte[] readAllBytes(String path) throws IOException {
        File file = new File(path);
        try (InputStream is = new FileInputStream(file)) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = is.read(chunk)) > 0) {
                buffer.write(chunk, 0, n);
            }
            return buffer.toByteArray();
        }
    }

    private void cleanupStagedFile(String path) {
        if (path == null) return;
        try {
            File f = new File(path);
            if (f.exists()) f.delete();
        } catch (Exception ignored) {
            // best-effort cleanup
        }
    }

    private String sanitize(String name) {
        if (name == null) return "backup";
        return name.replaceAll("[^a-zA-Z0-9._-]", "_");
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
