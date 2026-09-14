package br.radar.nfsu2;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Atualização automática pelas Releases do GitHub.
 * Procura a versão mais nova, baixa o APK direto para o instalador do Android (PackageInstaller)
 * e o sistema pede a confirmação ao usuário. O resultado volta para a MainActivity via ACTION_INSTALL_STATUS.
 */
class Updater {

    static final String ACTION_INSTALL_STATUS = "br.radar.nfsu2.INSTALL_STATUS";
    private static final String LATEST_RELEASE = "https://api.github.com/repos/clatzao/radar-nfsu2/releases/latest";

    interface Js { void run(String script); }

    private final Activity activity;
    private final Js js;
    private final ExecutorService bg = Executors.newSingleThreadExecutor();
    private volatile String apkUrl, newVersion;
    private volatile boolean busy = false;

    Updater(Activity activity, Js js) {
        this.activity = activity;
        this.js = js;
    }

    String currentVersion() {
        try {
            return activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "0";
        }
    }

    /** Consulta a última release. manual = true mostra "já está atualizado" ou o erro. */
    void check(boolean manual) {
        bg.execute(() -> {
            try {
                HttpURLConnection c = open(LATEST_RELEASE);
                c.setRequestProperty("Accept", "application/vnd.github+json");
                int code = c.getResponseCode();
                if (code != 200) throw new IOException("GitHub respondeu " + code);
                JSONObject rel = new JSONObject(readAll(c.getInputStream()));
                String tag = rel.optString("tag_name", "");
                String url = null;
                JSONArray assets = rel.optJSONArray("assets");
                for (int i = 0; assets != null && i < assets.length(); i++) {
                    JSONObject a = assets.getJSONObject(i);
                    if (a.optString("name").toLowerCase().endsWith(".apk")) url = a.optString("browser_download_url");
                }
                String current = currentVersion();
                if (url != null && compare(tag, current) > 0) {
                    apkUrl = url;
                    newVersion = clean(tag);
                    js.run("window.onUpdateAvailable && window.onUpdateAvailable(" + JSONObject.quote(newVersion) + ","
                            + JSONObject.quote(current) + "," + JSONObject.quote(rel.optString("body", "")) + ")");
                } else if (manual) {
                    js.run("window.onUpdateNone && window.onUpdateNone(" + JSONObject.quote(current) + ")");
                }
            } catch (Exception e) {
                if (manual) status("Não foi possível verificar atualizações: " + e.getMessage());
            }
        });
    }

    /** Baixa e instala a versão encontrada em check(). */
    void install() {
        if (apkUrl == null || busy) return;
        // Android 8+: o usuário precisa permitir que este app instale atualizações (uma vez só)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.getPackageManager().canRequestPackageInstalls()) {
            status("Permita \"Instalar apps desconhecidos\" para o Radar NFSU2 e toque em Atualizar de novo.");
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName())));
            return;
        }
        busy = true;
        bg.execute(() -> {
            PackageInstaller pi = activity.getPackageManager().getPackageInstaller();
            int sessionId = -1;
            try {
                PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(activity.getPackageName());
                sessionId = pi.createSession(params);
                try (PackageInstaller.Session session = pi.openSession(sessionId)) {
                    HttpURLConnection c = open(apkUrl);
                    int code = c.getResponseCode();
                    if (code != 200) throw new IOException("download respondeu " + code);
                    long total = c.getContentLengthLong();
                    try (InputStream in = c.getInputStream(); OutputStream out = session.openWrite("radar-nfsu2.apk", 0, total)) {
                        byte[] buf = new byte[64 * 1024];
                        long done = 0;
                        int n, lastPct = -1;
                        while ((n = in.read(buf)) > 0) {
                            out.write(buf, 0, n);
                            done += n;
                            int pct = total > 0 ? (int) (done * 100 / total) : -1;
                            if (pct != lastPct && (pct - lastPct >= 5 || pct == 100)) {
                                lastPct = pct;
                                js.run("window.onUpdateProgress && window.onUpdateProgress(" + pct + ")");
                            }
                        }
                        session.fsync(out);
                    }
                    Intent result = new Intent(activity, MainActivity.class)
                            .setAction(ACTION_INSTALL_STATUS)
                            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    int flags = PendingIntent.FLAG_UPDATE_CURRENT
                            | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
                    PendingIntent pending = PendingIntent.getActivity(activity, 77, result, flags);
                    status("Instalando a versão " + newVersion + "…");
                    session.commit(pending.getIntentSender());
                }
            } catch (Exception e) {
                if (sessionId != -1) try { pi.abandonSession(sessionId); } catch (Exception ignored) { }
                status("Falha ao baixar a atualização: " + e.getMessage());
            } finally {
                busy = false;
            }
        });
    }

    /** Resposta do instalador do Android. */
    @SuppressWarnings("deprecation")
    void onInstallStatus(Intent intent) {
        int st = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) activity.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } else if (st == PackageInstaller.STATUS_SUCCESS) {
            status("Atualizado! Abra o app de novo se ele não reabrir sozinho.");
        } else if (st == PackageInstaller.STATUS_FAILURE_ABORTED) {
            status("Atualização cancelada.");
        } else {
            String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            status("A atualização não foi instalada" + (msg != null ? ": " + msg : "."));
        }
    }

    private void status(String msg) {
        js.run("window.onUpdateStatus && window.onUpdateStatus(" + JSONObject.quote(msg) + ")");
    }

    private static HttpURLConnection open(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", "RadarNFSU2-Android");
        return c;
    }

    private static String readAll(InputStream in) throws IOException {
        try (InputStream is = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }

    private static String clean(String v) {
        return v == null ? "0" : v.replaceAll("[^0-9.]", "");
    }

    /** Compara versões tipo "0.10" e "v0.9" parte a parte (0.10 é maior que 0.9). */
    static int compare(String a, String b) {
        String[] x = clean(a).split("\\."), y = clean(b).split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? parse(x[i]) : 0, q = i < y.length ? parse(y[i]) : 0;
            if (p != q) return Integer.compare(p, q);
        }
        return 0;
    }

    private static int parse(String s) {
        try { return Integer.parseInt(s); } catch (NumberFormatException e) { return 0; }
    }
}
