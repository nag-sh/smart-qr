package sh.nag.smartqr;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PrintPlugin.class);
        registerPlugin(SaveAsPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void load() {
        super.load();
        Bridge bridge = getBridge();
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setWebChromeClient(new CameraWebChromeClient(bridge));
        }
    }

    private static class CameraWebChromeClient extends BridgeWebChromeClient {
        public CameraWebChromeClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            // Delegate to Capacitor's BridgeWebChromeClient, which correctly
            // requests the Android CAMERA runtime permission (showing the system
            // prompt) BEFORE granting the WebView-level permission. Granting the
            // WebView permission directly without the Android runtime permission
            // makes getUserMedia hang with no error (the camera never opens),
            // which is why the in-app camera did nothing in every view.
            super.onPermissionRequest(request);
        }
    }
}
