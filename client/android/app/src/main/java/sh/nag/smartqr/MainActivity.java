package sh.nag.smartqr;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;

public class MainActivity extends BridgeActivity {
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
            // Grant camera access for the WebView's getUserMedia (live QR scanning).
            request.grant(request.getResources());
        }
    }
}
