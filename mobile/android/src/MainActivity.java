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

    private final android.os.Handler updateHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private long updateDownload = -1;

    private void openUpdate() {
        if (!getPackageManager().canRequestPackageInstalls()) {
            new android.app.AlertDialog.Builder(this)
                .setTitle("Permitir atualizações")
                .setMessage("Autorize o StreamRoom a instalar atualizações. Depois volte ao app e toque em Baixar atualização.")
                .setNegativeButton("Cancelar", null)
                .setPositiveButton("Abrir configurações", (dialog, button) ->
                    startActivity(new android.content.Intent(
                        android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        android.net.Uri.parse("package:" + getPackageName()))))
                .show();
            return;
        }
        if (updateDownload != -1) return;
        android.app.DownloadManager downloads = getSystemService(android.app.DownloadManager.class);
        android.app.DownloadManager.Request request = new android.app.DownloadManager.Request(
            android.net.Uri.parse(SITE + "/StreamRoom-Android-teste.apk"));
        request.setTitle("Atualização do StreamRoom");
        request.setMimeType("application/vnd.android.package-archive");
        request.setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE);
        updateDownload = downloads.enqueue(request);
        android.widget.Toast.makeText(this, "Baixando atualização…", android.widget.Toast.LENGTH_SHORT).show();
        updateHandler.postDelayed(this::checkDownload, 1000);
    }

    private void checkDownload() {
        android.app.DownloadManager downloads = getSystemService(android.app.DownloadManager.class);
        try (android.database.Cursor rows = downloads.query(
                new android.app.DownloadManager.Query().setFilterById(updateDownload))) {
            if (rows != null && rows.moveToFirst()) {
                int status = rows.getInt(rows.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_STATUS));
                if (status == android.app.DownloadManager.STATUS_SUCCESSFUL) {
                    android.net.Uri file = downloads.getUriForDownloadedFile(updateDownload);
                    updateDownload = -1;
                    if (file != null) {
                        try {
                            startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW)
                                .setDataAndType(file, "application/vnd.android.package-archive")
                                .addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION));
                            return;
                        } catch (android.content.ActivityNotFoundException ignored) { }
                    }
                } else if (status != android.app.DownloadManager.STATUS_FAILED) {
                    updateHandler.postDelayed(this::checkDownload, 1000);
                    return;
                }
            }
        }
        updateDownload = -1;
        android.widget.Toast.makeText(this, "Não foi possível abrir a atualização.", android.widget.Toast.LENGTH_LONG).show();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (updateDownload == -1) checkForUpdate();
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
        android.widget.LinearLayout layout = new android.widget.LinearLayout(this);
        layout.setOrientation(android.widget.LinearLayout.VERTICAL);
        android.widget.Button google = new android.widget.Button(this);
        google.setText("Entrar com Google");
        google.setOnClickListener(button -> new GoogleProfile(this).choose(profile -> {
            if (!VIEWER.equals(viewer.getUrl())) return;
            viewer.evaluateJavascript(
                "window.streamRoomApplyGoogleProfile?.(" + profile + ")", null);
        }));
        layout.addView(google);
        layout.addView(viewer, new android.widget.LinearLayout.LayoutParams(-1, 0, 1));
        layout.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(layout);
        viewer.loadUrl(VIEWER);

    }

    @Override
    protected void onDestroy() {
        setContentView(new android.widget.FrameLayout(this));
        updateHandler.removeCallbacksAndMessages(null);
        viewer.destroy();
        super.onDestroy();
    }
}
