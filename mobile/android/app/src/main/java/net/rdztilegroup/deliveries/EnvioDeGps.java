package net.rdztilegroup.deliveries;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * D-838 (APK 7): sube las posiciones al servidor DESDE ANDROID, sin pasar por la página.
 *
 * Con el teléfono bloqueado Android congela la página de la app, y lo que la página tenía que subir llegaba al servidor
 * 20+ minutos tarde (medido el 2026-11-04). Esto corre en un hilo propio de la app nativa, que sigue viva gracias al
 * servicio en primer plano del GPS.
 *
 * Una cola guardada en el teléfono: sin señal, las posiciones esperan (hasta 2 000, se tiran las más viejas) y salen en
 * orden, en lotes de 200, en cuanto hay red. Un 401 (llave caducada) deja la cola intacta hasta que la página dé otra.
 */
final class EnvioDeGps {
    private static final String PREFS = "rtg_gps_directo";
    private static final String CLAVE = "cola";
    private static final int MAX = 2000;
    private static final int LOTE = 200;

    private final SharedPreferences prefs;
    private final ExecutorService hilo = Executors.newSingleThreadExecutor();
    private final List<JSONObject> cola = new ArrayList<>();
    private volatile String url;
    private volatile String token;
    volatile long ultimoOk = 0;
    volatile String ultimoError = null;

    EnvioDeGps(Context ctx) {
        prefs = ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        carga();
    }

    void configura(String url, String token) {
        this.url = url;
        this.token = token;
    }

    void agrega(JSONObject fix) {
        synchronized (cola) {
            cola.add(fix);
            while (cola.size() > MAX) cola.remove(0);
            guarda();
        }
        hilo.execute(this::vacia);
    }

    void reintenta() {
        hilo.execute(this::vacia);
    }

    int pendientes() {
        synchronized (cola) { return cola.size(); }
    }

    private void vacia() {
        while (true) {
            List<JSONObject> lote;
            synchronized (cola) {
                if (cola.isEmpty() || url == null || token == null) return;
                lote = new ArrayList<>(cola.subList(0, Math.min(LOTE, cola.size())));
            }
            int code = envia(lote);
            if ((code >= 200 && code < 300) || code == 400) {
                // 400 = el servidor no lo acepta y nunca lo aceptará: se tira para no atascar la cola.
                synchronized (cola) {
                    int n = Math.min(lote.size(), cola.size());
                    cola.subList(0, n).clear();
                    guarda();
                }
                if (code != 400) { ultimoOk = System.currentTimeMillis(); ultimoError = null; }
            } else {
                ultimoError = code == 401 ? "llave caducada" : ("http " + code);
                return;
            }
        }
    }

    private int envia(List<JSONObject> lote) {
        HttpURLConnection c = null;
        try {
            JSONArray arr = new JSONArray();
            for (JSONObject o : lote) arr.put(o);
            byte[] cuerpo = new JSONObject().put("fixes", arr).toString().getBytes(StandardCharsets.UTF_8);
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(20000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Authorization", "Bearer " + token);
            try (OutputStream os = c.getOutputStream()) { os.write(cuerpo); }
            return c.getResponseCode();
        } catch (Exception e) {
            ultimoError = e.getClass().getSimpleName();
            return -1;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private void carga() {
        try {
            JSONArray arr = new JSONArray(prefs.getString(CLAVE, "[]"));
            synchronized (cola) {
                for (int i = 0; i < arr.length(); i++) cola.add(arr.getJSONObject(i));
            }
        } catch (Exception ignored) {
            // Una cola ilegible se empieza de cero: perder unas posiciones es mejor que no arrancar.
        }
    }

    private void guarda() {
        JSONArray arr = new JSONArray();
        for (JSONObject o : cola) arr.put(o);
        prefs.edit().putString(CLAVE, arr.toString()).apply();
    }
}
