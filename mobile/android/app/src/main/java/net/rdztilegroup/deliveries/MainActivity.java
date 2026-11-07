package net.rdztilegroup.deliveries;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        // Registered before super so the bridge picks it up on first load —
        // the web app checks battery-optimisation state as soon as a driver
        // clocks in.
        registerPlugin(BatteryGuardPlugin.class);
        super.onCreate(savedInstanceState);
        // D-NEXT: the camera of <input capture> when the app has no camera permission (asks; if denied, falls back to
        // the gallery with a hint instead of doing nothing). Still in onCreate, so its launchers register before onStart.
        getBridge().getWebView().setWebChromeClient(new CamaraDelFormulario(getBridge()));
    }
}
