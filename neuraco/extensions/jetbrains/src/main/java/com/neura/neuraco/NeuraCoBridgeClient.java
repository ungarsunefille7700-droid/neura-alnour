package com.neura.neuraco;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;

final class NeuraCoBridgeClient {
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(3);
    private static final Duration READ_TIMEOUT = Duration.ofMinutes(3);
    private final Gson gson = new Gson();
    private final HttpClient client = HttpClient.newBuilder()
        .connectTimeout(CONNECT_TIMEOUT)
        .followRedirects(HttpClient.Redirect.NEVER)
        .build();
    private final BridgeManifestLocator manifestLocator =
        new BridgeManifestLocator(gson);

    BridgeModels.Context getContext() throws IOException, InterruptedException {
        return request("GET", "/v1/context", null, BridgeModels.Context.class);
    }

    BridgeModels.Conversation createThread(String title)
        throws IOException, InterruptedException {
        JsonObject body = new JsonObject();
        if (title != null && !title.isBlank()) body.addProperty("title", title.trim());
        return request(
            "POST",
            "/v1/threads",
            body,
            BridgeModels.Conversation.class
        );
    }

    BridgeModels.Conversation selectThread(String threadId)
        throws IOException, InterruptedException {
        JsonObject body = new JsonObject();
        body.addProperty("threadId", threadId);
        return request(
            "POST",
            "/v1/threads/select",
            body,
            BridgeModels.Conversation.class
        );
    }

    BridgeModels.ChatResult chat(
        String content,
        String threadId,
        String agentId,
        String model,
        String mode,
        List<BridgeModels.FileContext> files
    ) throws IOException, InterruptedException {
        JsonObject body = new JsonObject();
        body.addProperty("content", content);
        if (threadId != null) body.addProperty("threadId", threadId);
        if (agentId != null) body.addProperty("agentId", agentId);
        body.addProperty("model", model == null ? "auto" : model);
        body.addProperty("mode", "plan".equals(mode) ? "plan" : "question");
        JsonArray fileArray = new JsonArray();
        for (BridgeModels.FileContext file : files) {
            JsonObject value = new JsonObject();
            value.addProperty("path", file.path);
            value.addProperty("content", file.content);
            if (file.language != null) value.addProperty("language", file.language);
            fileArray.add(value);
        }
        body.add("files", fileArray);
        return request("POST", "/v1/chat", body, BridgeModels.ChatResult.class);
    }

    private <T> T request(
        String method,
        String route,
        JsonObject body,
        Class<T> responseType
    ) throws IOException, InterruptedException {
        BridgeModels.Manifest manifest = manifestLocator.load();
        URI uri = URI.create("http://127.0.0.1:" + manifest.port + route);
        HttpRequest.Builder builder = HttpRequest.newBuilder(uri)
            .timeout(READ_TIMEOUT)
            .header("Authorization", "Bearer " + manifest.token)
            .header("Accept", "application/json");
        if ("POST".equals(method)) {
            builder
                .header("Content-Type", "application/json; charset=utf-8")
                .POST(HttpRequest.BodyPublishers.ofString(
                    body == null ? "{}" : gson.toJson(body)
                ));
        } else {
            builder.GET();
        }
        HttpResponse<String> response = client.send(
            builder.build(),
            HttpResponse.BodyHandlers.ofString()
        );
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IOException(errorMessage(response.body(), response.statusCode()));
        }
        try {
            T parsed = gson.fromJson(response.body(), responseType);
            if (parsed == null) throw new IllegalStateException("empty");
            return parsed;
        } catch (RuntimeException error) {
            throw new IOException("Réponse locale NeuraCo invalide.", error);
        }
    }

    static String errorMessage(String body, int status) {
        try {
            JsonObject parsed = JsonParser.parseString(body).getAsJsonObject();
            if (parsed.has("error")) return parsed.get("error").getAsString();
        } catch (RuntimeException ignored) {
            // A controlled generic message is safer than returning raw HTML.
        }
        return "NeuraCo Desktop a refusé la demande locale (HTTP " + status + ").";
    }
}
