package br.radar.nfsu2;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;

/**
 * Tela única: a interface é a página web em assets/index.html (mesma do protótipo),
 * e o GPS vem direto da antena da central via LocationManager, sem Google Play Services
 * (muitas centrais Android não têm).
 */
public class MainActivity extends Activity implements LocationListener {

    private static final int REQ_LOCATION = 1;
    /** Ignora posições da rede enquanto o GPS de verdade estiver respondendo. */
    private static final long GPS_PRIORITY_MS = 5000;
    /**
     * A interface é servida por este endereço https "de mentira" (reservado pelo Android para assets de apps).
     * Em https o navegador interno permite guardar os mapas offline (IndexedDB), o que em file:// não é garantido.
     */
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String APP_URL = "https://" + APP_HOST + "/index.html";

    private WebView web;
    private LocationManager locationManager;
    private boolean gpsWanted = false;
    private boolean listening = false;
    private long lastGpsFixAt = 0;
    private long lastFusedFixAt = 0;

    private TextToSpeech tts;
    private boolean ttsReady = false;
    private AudioManager audio;
    private AudioFocusRequest focusRequest;

    private Updater updater;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        web = new WebView(this);
        web.setBackgroundColor(0xFF2E302C);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // Zoom só dentro do mapa (feito pela página); a tela do app nunca amplia
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);   // ignora o "tamanho da fonte" do sistema para não quebrar o layout
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new AssetClient());
        updater = new Updater(this, script -> runOnUiThread(() -> web.evaluateJavascript(script, null)));
        web.addJavascriptInterface(new Bridge(), "NFSU2Native");
        setContentView(web);
        // Na primeira abertura depois de atualizar, copia os dados salvos (locais, ajustes) do endereço antigo file://
        if (prefs().getBoolean("storage_migrated", false)) web.loadUrl(APP_URL);
        else {
            web.loadUrl("file:///android_asset/migrate.html");
            // segurança: se a migração não responder em 4 s, abre o app mesmo assim
            web.postDelayed(() -> {
                if (!prefs().getBoolean("storage_migrated", false)) {
                    prefs().edit().putBoolean("storage_migrated", true).apply();
                    web.loadUrl(APP_URL);
                }
            }, 4000);
        }
        hideSystemBars();
        setupVoice();
    }

    private SharedPreferences prefs() {
        return getSharedPreferences("radar", MODE_PRIVATE);
    }

    /** Entrega os arquivos da interface (assets) no endereço https do app. */
    private class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!APP_HOST.equals(url.getHost())) return null;          // mapa, busca, rotas: vão para a internet normalmente
            String path = url.getPath() == null || url.getPath().equals("/") ? "index.html" : url.getPath().substring(1);
            try {
                InputStream in = getAssets().open(path);
                String mime = mimeOf(path);
                boolean text = mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json");
                return new WebResourceResponse(mime, text ? "UTF-8" : null, in);
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, null);
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return false;
        }
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase(Locale.US);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }

    /** Voz das instruções: usa o leitor de texto do Android em português e abaixa a música enquanto fala. */
    private void setupVoice() {
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) return;
            int r = tts.setLanguage(new Locale("pt", "BR"));
            if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) tts.setLanguage(new Locale("pt"));
            tts.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) { releaseFocus(); }
                @Override public void onError(String id) { releaseFocus(); }
            });
            ttsReady = true;
        });
    }

    @SuppressWarnings("deprecation")
    private void requestFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    .build();
            audio.requestAudioFocus(focusRequest);
        } else {
            audio.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
        }
    }

    @SuppressWarnings("deprecation")
    private void releaseFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest != null) audio.abandonAudioFocusRequest(focusRequest);
        } else {
            audio.abandonAudioFocus(null);
        }
    }

    /** Métodos chamados pela página (window.NFSU2Native.start() / stop()). */
    private class Bridge {
        @JavascriptInterface
        public void start() {
            runOnUiThread(() -> {
                gpsWanted = true;
                startLocation();
            });
        }

        /** Chamado por migrate.html com todo o localStorage antigo. */
        @JavascriptInterface
        public void migrationDone(String json) {
            prefs().edit().putString("migration_json", json).putBoolean("storage_migrated", true).apply();
            runOnUiThread(() -> web.loadUrl(APP_URL));
        }

        /** A página nova pega os dados antigos uma única vez. */
        @JavascriptInterface
        public String takeMigration() {
            String json = prefs().getString("migration_json", "");
            if (!json.isEmpty()) prefs().edit().remove("migration_json").apply();
            return json;
        }

        @JavascriptInterface
        public String getVersion() {
            return updater.currentVersion();
        }

        @JavascriptInterface
        public void checkUpdate(boolean manual) {
            updater.check(manual);
        }

        @JavascriptInterface
        public void installUpdate() {
            runOnUiThread(() -> updater.install());
        }

        @JavascriptInterface
        public void speak(String text) {
            runOnUiThread(() -> {
                if (!ttsReady || text == null || text.isEmpty()) return;
                requestFocus();
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "nav" + System.currentTimeMillis());
            });
        }

        @JavascriptInterface
        public void stop() {
            runOnUiThread(() -> {
                gpsWanted = false;
                stopLocation();
            });
        }
    }

    private void startLocation() {
        if (listening) return;
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
            return;
        }
        boolean gps = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER);
        boolean net = locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        if (!gps && !net) {
            sendStatus("Localização desligada nas configurações");
            return;
        }
        try {
            if (gps) {
                // meio segundo entre leituras: a seta e o nome da rua reagem mais rápido em cruzamentos
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 500, 0, this);
                Location last = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                if (last != null && System.currentTimeMillis() - last.getTime() < 30000) onLocationChanged(last);
            }
            // Android 12+: provedor "fused" do próprio sistema (combina GPS, sensores e Wi-Fi), sem Google Play
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                    && locationManager.getAllProviders().contains(LocationManager.FUSED_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.FUSED_PROVIDER, 500, 0, this);
            }
            if (net) {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 2000, 0, this);
            }
            listening = true;
            if (!gps) sendStatus("GPS desligado · usando rede (impreciso)");
        } catch (SecurityException e) {
            sendStatus("Sem permissão de localização");
        }
    }

    private void stopLocation() {
        if (!listening) return;
        locationManager.removeUpdates(this);
        listening = false;
    }

    @Override
    public void onLocationChanged(Location l) {
        String provider = l.getProvider();
        long now = System.currentTimeMillis();
        if (LocationManager.GPS_PROVIDER.equals(provider)) {
            lastGpsFixAt = now;
        } else if ("fused".equals(provider)) {
            // o fused só entra quando o GPS puro ficou mais de 1,5 s sem responder (ex.: túnel, prédios)
            if (now - lastGpsFixAt < 1500) return;
            lastFusedFixAt = now;
        } else if (now - lastGpsFixAt < GPS_PRIORITY_MS || now - lastFusedFixAt < GPS_PRIORITY_MS) {
            return;
        }
        String js = String.format(Locale.US, "window.nativeFix && window.nativeFix(%.7f,%.7f,%s,%s,%s,%d)",
                l.getLatitude(), l.getLongitude(),
                l.hasSpeed() ? String.format(Locale.US, "%.2f", l.getSpeed()) : "null",
                l.hasBearing() ? String.format(Locale.US, "%.1f", l.getBearing()) : "null",
                l.hasAccuracy() ? String.format(Locale.US, "%.1f", l.getAccuracy()) : "null",
                System.currentTimeMillis());
        web.evaluateJavascript(js, null);
    }

    // Necessários em Android 9 ou anterior, onde não têm implementação padrão
    @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
    @Override public void onProviderEnabled(String provider) { }
    @Override public void onProviderDisabled(String provider) { }

    private void sendStatus(String txt) {
        String escaped = txt.replace("\\", "\\\\").replace("'", "\\'");
        web.evaluateJavascript("window.nativeStatus && window.nativeStatus('" + escaped + "')", null);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQ_LOCATION) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            if (gpsWanted) startLocation();
        } else {
            sendStatus("Permissão de localização negada");
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (Updater.ACTION_INSTALL_STATUS.equals(intent.getAction())) updater.onInstallStatus(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        if (gpsWanted) startLocation();
        hideSystemBars();
    }

    @Override
    protected void onPause() {
        stopLocation();
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        stopLocation();
        if (tts != null) tts.shutdown();
        web.destroy();
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }
}
