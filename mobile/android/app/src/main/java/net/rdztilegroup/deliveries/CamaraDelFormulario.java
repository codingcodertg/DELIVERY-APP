package net.rdztilegroup.deliveries;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.Arrays;

/**
 * D-NEXT (2026-11-07): la cámara de un {@code <input type="file" capture="environment">} cuando la app no tiene el
 * permiso de cámara.
 *
 * Baudelio llenó la primera merma del formulario nuevo desde esta app (APK 6, Android 16) y «no lo dejaba poner la
 * foto; la tuvo que escoger del carrete». Lo que hace Capacitor 6 ({@link BridgeWebChromeClient#onShowFileChooser}):
 * con {@code capture} pide el permiso CAMERA; si lo niegan —o ya estaba negado «para siempre», en cuyo caso Android ni
 * pregunta— contesta {@code null} y la página no ve NADA: ni foto, ni error. Para quien llena, el botón no hace nada.
 *
 * Aquí, solo en ese caso (capture de imagen y permiso sin conceder):
 *   1. Se pide el permiso. Si lo dan, sigue Capacitor como siempre (abre la cámara con su FileProvider).
 *   2. Si lo niegan, un aviso corto dice cómo darlo en Ajustes y se abre el selector de la galería en su lugar, para
 *      que la foto se pueda poner de todos modos. Y si cancelan, la página recibe su {@code cancel} igual que siempre.
 *
 * Todo lo demás (permiso ya dado, galería sin {@code capture}, getUserMedia de «📸 Varias fotos») sigue en Capacitor.
 */
public class CamaraDelFormulario extends BridgeWebChromeClient {

    private final Bridge bridge;
    private final ActivityResultLauncher<String> permiso;
    private final ActivityResultLauncher<Intent> galeria;

    private ValueCallback<Uri[]> pendiente;
    private FileChooserParams parametros;
    private WebView vista;

    public CamaraDelFormulario(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
        this.permiso = bridge.registerForActivityResult(new ActivityResultContracts.RequestPermission(), this::alContestarElPermiso);
        this.galeria = bridge.registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), r -> {
            ValueCallback<Uri[]> cb = pendiente;
            pendiente = null;
            if (cb != null) cb.onReceiveValue(FileChooserParams.parseResult(r.getResultCode(), r.getData()));
        });
    }

    @Override
    public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
        boolean quiereCamara = fileChooserParams.isCaptureEnabled()
            && Arrays.asList(fileChooserParams.getAcceptTypes()).contains("image/*");
        boolean conPermiso = ContextCompat.checkSelfPermission(bridge.getContext(), Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
        if (!quiereCamara || conPermiso) {
            return super.onShowFileChooser(webView, filePathCallback, fileChooserParams);
        }
        // Un selector a la vez: si llega otro mientras uno espera, el de antes se cierra sin foto.
        if (pendiente != null) pendiente.onReceiveValue(null);
        pendiente = filePathCallback;
        parametros = fileChooserParams;
        vista = webView;
        permiso.launch(Manifest.permission.CAMERA);
        return true;
    }

    private void alContestarElPermiso(Boolean concedido) {
        ValueCallback<Uri[]> cb = pendiente;
        FileChooserParams p = parametros;
        WebView w = vista;
        if (cb == null || p == null) return;
        if (Boolean.TRUE.equals(concedido)) {
            // Ahora Capacitor ve el permiso y abre la cámara.
            pendiente = null;
            super.onShowFileChooser(w, cb, p);
            return;
        }
        Activity a = bridge.getActivity();
        if (a != null) {
            Toast.makeText(a, "Sin permiso de cámara: actívalo en Ajustes › Aplicaciones › RTG Hub › Permisos. Mientras, elige la foto de la galería.", Toast.LENGTH_LONG).show();
        }
        Intent intent = p.createIntent();
        try {
            galeria.launch(intent);
        } catch (Exception e) {
            pendiente = null;
            cb.onReceiveValue(null);
        }
    }
}
