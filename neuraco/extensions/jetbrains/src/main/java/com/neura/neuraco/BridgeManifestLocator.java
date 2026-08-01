package com.neura.neuraco;

import com.google.gson.Gson;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

final class BridgeManifestLocator {
    private static final int MAX_MANIFEST_BYTES = 32 * 1024;
    private final Gson gson;

    BridgeManifestLocator(Gson gson) {
        this.gson = gson;
    }

    BridgeModels.Manifest load() throws IOException {
        IOException lastError = null;
        for (Path candidate : candidates()) {
            try {
                if (!Files.isRegularFile(candidate)) continue;
                long size = Files.size(candidate);
                if (size < 2 || size > MAX_MANIFEST_BYTES) {
                    throw new IOException("Le manifeste NeuraCo local est invalide.");
                }
                String raw = Files.readString(candidate, StandardCharsets.UTF_8);
                BridgeModels.Manifest manifest = gson.fromJson(
                    raw,
                    BridgeModels.Manifest.class
                );
                validate(manifest);
                return manifest;
            } catch (IOException error) {
                lastError = error;
            } catch (RuntimeException error) {
                lastError = new IOException(
                    "Le manifeste NeuraCo local est illisible.",
                    error
                );
            }
        }
        if (lastError != null) throw lastError;
        throw new IOException(
            "Lancez NeuraCo Desktop, connectez-vous et ouvrez un projet."
        );
    }

    private static void validate(BridgeModels.Manifest manifest) throws IOException {
        if (
            manifest == null
            || manifest.protocolVersion != 1
            || manifest.port < 1024
            || manifest.port > 65535
            || manifest.token == null
            || manifest.token.length() < 32
            || manifest.pid <= 0
        ) {
            throw new IOException("Association locale NeuraCo invalide.");
        }
    }

    private static List<Path> candidates() {
        String appData = System.getenv("APPDATA");
        if (appData == null || appData.isBlank()) return List.of();
        List<Path> paths = new ArrayList<>();
        for (String directory : List.of("NeuraCo", "neuraco", "com.neura.neuraco")) {
            paths.add(Path.of(appData, directory, "integrations", "ide-bridge.json"));
        }
        return paths;
    }
}
