package com.arthostudio.streamroom;

import android.app.Activity;
import android.widget.Toast;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import org.json.JSONObject;
import java.util.function.Consumer;

final class GoogleProfile {
    private static final String WEB_CLIENT =
        "586504743743-c9u9o5edn1ihv601v2m22s0s1iv6beh8.apps.googleusercontent.com";
    private final Activity activity;

    GoogleProfile(Activity activity) {
        this.activity = activity;
    }

    void choose(Consumer<JSONObject> onProfile) {
        byte[] random = new byte[32];
        new java.security.SecureRandom().nextBytes(random);
        String nonce = android.util.Base64.encodeToString(random,
            android.util.Base64.URL_SAFE | android.util.Base64.NO_WRAP | android.util.Base64.NO_PADDING);
        GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(WEB_CLIENT)
            .setNonce(nonce).build();
        GetCredentialRequest request = new GetCredentialRequest.Builder()
            .addCredentialOption(option).build();

        CredentialManager.create(activity).getCredentialAsync(activity, request, null,
            activity::runOnUiThread, new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    if (activity.isDestroyed()) return;
                    try {
                        if (!(response.getCredential() instanceof CustomCredential)) {
                            showError();
                            return;
                        }
                        CustomCredential credential = (CustomCredential) response.getCredential();
                        if (!GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                            showError();
                            return;
                        }
                        GoogleIdTokenCredential google = GoogleIdTokenCredential.createFrom(credential.getData());
                        JSONObject profile = new JSONObject();
                        profile.put("name", google.getDisplayName());
                        if (google.getProfilePictureUri() != null) {
                            profile.put("picture", google.getProfilePictureUri().toString());
                        }
                        findActiveRoom(google.getIdToken(), nonce, profile, onProfile);
                    } catch (Exception error) {
                        showError();
                    }
                }

                @Override
                public void onError(GetCredentialException error) {
                    if (!(error instanceof GetCredentialCancellationException)) showError();
                }
            });
    }

    private void findActiveRoom(String credential, String nonce, JSONObject profile,
                                Consumer<JSONObject> onProfile) {
        new Thread(() -> {
            java.net.HttpURLConnection connection = null;
            try {
                JSONObject request = new JSONObject();
                request.put("operation", "find");
                request.put("credential", credential);
                request.put("nonce", nonce);
                byte[] body = request.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
                connection = (java.net.HttpURLConnection) new java.net.URL(
                    "https://streamroom.arthostudio.com/v2/account/active-room").openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(6000);
                connection.setReadTimeout(6000);
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setFixedLengthStreamingMode(body.length);
                try (java.io.OutputStream output = connection.getOutputStream()) { output.write(body); }
                if (connection.getResponseCode() == 200) {
                    try (java.io.InputStream input = connection.getInputStream();
                         java.io.ByteArrayOutputStream response = new java.io.ByteArrayOutputStream()) {
                        byte[] buffer = new byte[512];
                        for (int count; (count = input.read(buffer)) != -1;) {
                            if (response.size() + count > 2048) throw new java.io.IOException();
                            response.write(buffer, 0, count);
                        }
                        JSONObject result = new JSONObject(response.toString("UTF-8"));
                        profile.put("activeRoom", result.optBoolean("active"));
                        if (result.optBoolean("active")) profile.put("invitation", result.getString("invitation"));
                    }
                }
            } catch (Exception ignored) {
                // The local profile remains usable when the sync service is unavailable.
            } finally {
                if (connection != null) connection.disconnect();
            }
            activity.runOnUiThread(() -> {
                if (!activity.isDestroyed()) onProfile.accept(profile);
            });
        }, "streamroom-active-room").start();
    }

    private void showError() {
        if (!activity.isDestroyed()) {
            Toast.makeText(activity, "Não foi possível acessar seu perfil Google.", Toast.LENGTH_LONG).show();
        }
    }
}
