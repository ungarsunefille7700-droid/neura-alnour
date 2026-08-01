package com.neura.neuraco;

import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.List;

final class BridgeModels {
    private BridgeModels() {}

    static final class Manifest {
        int protocolVersion;
        int port;
        String token;
        long pid;
        String generatedAt;
    }

    static final class Context {
        ProjectInfo project;
        List<ThreadInfo> threads = new ArrayList<>();
        Conversation activeThread;
        List<AgentInfo> agents = new ArrayList<>();
        PermissionInfo permissions;
        List<ModelInfo> models = new ArrayList<>();
        JsonObject usage;
    }

    static final class ProjectInfo {
        String id;
        String name;
        String rootPath;
    }

    static final class ThreadInfo {
        String threadId;
        String title;
        boolean active;
        int messageCount;

        @Override
        public String toString() {
            return (active ? "● " : "") + safe(title, "Tâche")
                + " (" + messageCount + ")";
        }
    }

    static final class Conversation {
        String threadId;
        String title;
        String sessionId;
        List<Message> messages = new ArrayList<>();
    }

    static final class Message {
        String role;
        String content;
        String model;
    }

    static final class AgentInfo {
        String id;
        String name;
        String role;
        String model;

        @Override
        public String toString() {
            return safe(name, "Agent") + " — " + safe(role, "Assistant");
        }
    }

    static final class PermissionInfo {
        String mode;
        boolean configured;
        List<String> allowedActions = new ArrayList<>();
        List<String> allowedFolders = new ArrayList<>();
    }

    static final class ModelInfo {
        String id;
        String name;
        String provider;

        @Override
        public String toString() {
            return safe(name, id) + " — " + safe(provider, "NeuraCo");
        }
    }

    static final class FileContext {
        final String path;
        final String content;
        final String language;

        FileContext(String path, String content, String language) {
            this.path = path;
            this.content = content;
            this.language = language;
        }
    }

    static final class ChatResult {
        AgentResponse response;
        Conversation thread;
    }

    static final class AgentResponse {
        String message;
        String provider;
        String model;
        String modelDisplay;
    }

    static String safe(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }
}
