package com.arthostudio.streamroom;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public final class MainActivity extends Activity {
    private static final String VIEWER = "https://streamroom-773.pages.dev/mobile/";
    private static final String SITE = "https://streamroom-773.pages.dev";
    private WebView viewer;

    private void checkForUpdate() {
        new Thread(() -> {
            java.net.HttpURLConnection connection = null;
            try {
                connection = (java.net.HttpURLConnection)
                    new java.net.URL(SITE + "/android-version.txt").openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(5000);
                connection.setReadTimeout(5000);
                if (connection.getResponseCode() != 200) return;
                byte[] buffer = new byte[16];
                int length = 0;
                try (java.io.InputStream input = connection.getInputStream()) {
                    int next;
                    while ((next = input.read()) != -1) {
                        if (length == buffer.length) return;
                        buffer[length++] = (byte) next;
                    }
                }
                int latest = Integer.parseInt(new String(buffer, 0, length,
                    java.nio.charset.StandardCharsets.US_ASCII).trim());
                int installed = getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
                if (latest <= installed) return;
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    new android.app.AlertDialog.Builder(this)
                        .setTitle("Atualização disponível")
                        .setMessage("Baixe a nova versão do StreamRoom e confirme a instalação no Android.")
                        .setNegativeButton("Agora não", null)
                        .setPositiveButton("Baixar atualização", (dialog, button) -> openUpdate())
                        .show();
                });
            } catch (java.io.IOException | NumberFormatException |
                     android.content.pm.PackageManager.NameNotFoundException ignored) {
                // A falha na consulta não impede o uso da sala.
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "streamroom-update-check").start();
    }

    private void openUpdate() {
        android.net.Uri apk = android.net.Uri.parse(SITE + "/StreamRoom-Android-teste.apk");
        try {
            startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW, apk));
        } catch (android.content.ActivityNotFoundException error) {
            android.widget.Toast.makeText(this, "Abra o site do StreamRoom para atualizar.",
                android.widget.Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        viewer = new WebView(this);
        viewer.setBackgroundColor(0xff14131c);
        viewer.getSettings().setJavaScriptEnabled(true);
        viewer.getSettings().setDomStorageEnabled(true);
        viewer.getSettings().setAllowFileAccess(false);
        viewer.getSettings().setAllowContentAccess(false);
        viewer.getSettings().setMediaPlaybackRequiresUserGesture(false);
        viewer.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !VIEWER.equals(request.getUrl().toString());
            }
        });
        setContentView(viewer);
        viewer.loadUrl(VIEWER);
        checkForUpdate();
    }

    @Override
    protected void onDestroy() {
        setContentView(new android.widget.FrameLayout(this));
        viewer.destroy();
        super.onDestroy();
    }
}
