package com.neura.neuraco;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.ui.JBColor;
import com.intellij.ui.components.JBCheckBox;
import com.intellij.ui.components.JBLabel;
import com.intellij.ui.components.JBScrollPane;
import com.intellij.ui.components.JBTextArea;
import com.intellij.util.ui.JBUI;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.nio.file.Path;
import java.util.List;
import java.util.Objects;
import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JComboBox;
import javax.swing.JPanel;
import javax.swing.JSeparator;

final class NeuraCoToolWindowPanel extends JPanel {
    private final Project project;
    private final NeuraCoBridgeClient bridge = new NeuraCoBridgeClient();
    private final JBLabel status = new JBLabel("Connexion à NeuraCo Desktop…");
    private final JBLabel projectLabel = new JBLabel("Projet : —");
    private final JBLabel usageLabel = new JBLabel("Consommation : —");
    private final JBLabel rulesLabel = new JBLabel("Règles : —");
    private final JComboBox<BridgeModels.ThreadInfo> threads = new JComboBox<>();
    private final JComboBox<BridgeModels.AgentInfo> agents = new JComboBox<>();
    private final JComboBox<BridgeModels.ModelInfo> models = new JComboBox<>();
    private final JBTextArea transcript = new JBTextArea();
    private final JBTextArea input = new JBTextArea(4, 28);
    private final JBCheckBox includeEditor =
        new JBCheckBox("Inclure le fichier ouvert", true);
    private final JButton send = new JButton("Envoyer");
    private final JButton plan = new JButton("Planifier");
    private final JButton refresh = new JButton("Actualiser");
    private final JButton newThread = new JButton("Nouvelle tâche");
    private boolean replacingThreads;

    NeuraCoToolWindowPanel(Project project) {
        super(new BorderLayout());
        this.project = project;
        setBorder(JBUI.Borders.empty(10));
        add(header(), BorderLayout.NORTH);
        add(conversation(), BorderLayout.CENTER);
        add(composer(), BorderLayout.SOUTH);
        bindActions();
        refreshContext(true);
    }

    private JPanel header() {
        JPanel container = new JPanel();
        container.setLayout(new BoxLayout(container, BoxLayout.Y_AXIS));
        JPanel titleRow = new JPanel(new BorderLayout(8, 0));
        JBLabel title = new JBLabel("NeuraCo");
        title.setFont(title.getFont().deriveFont(18f));
        titleRow.add(title, BorderLayout.WEST);
        titleRow.add(refresh, BorderLayout.EAST);
        container.add(titleRow);
        container.add(Box.createVerticalStrut(6));
        container.add(status);
        container.add(projectLabel);
        container.add(usageLabel);
        container.add(rulesLabel);
        container.add(Box.createVerticalStrut(8));
        JPanel sessionRow = new JPanel(new BorderLayout(6, 0));
        sessionRow.add(threads, BorderLayout.CENTER);
        sessionRow.add(newThread, BorderLayout.EAST);
        container.add(sessionRow);
        container.add(Box.createVerticalStrut(6));
        container.add(agents);
        container.add(Box.createVerticalStrut(6));
        container.add(models);
        container.add(Box.createVerticalStrut(8));
        container.add(new JSeparator());
        container.add(Box.createVerticalStrut(8));
        return container;
    }

    private JPanel conversation() {
        transcript.setEditable(false);
        transcript.setLineWrap(true);
        transcript.setWrapStyleWord(true);
        transcript.setBorder(JBUI.Borders.empty(6));
        transcript.setText(
            "Les conversations, agents, règles, modèles et consommations "
            + "proviennent directement de NeuraCo Desktop.\n"
        );
        JBScrollPane scroll = new JBScrollPane(transcript);
        scroll.setBorder(BorderFactory.createLineBorder(JBColor.border()));
        JPanel container = new JPanel(new BorderLayout());
        container.add(scroll, BorderLayout.CENTER);
        container.setPreferredSize(new Dimension(360, 360));
        return container;
    }

    private JPanel composer() {
        input.setLineWrap(true);
        input.setWrapStyleWord(true);
        input.getEmptyText().setText("Décrivez la tâche ou posez une question…");
        JBScrollPane inputScroll = new JBScrollPane(input);
        inputScroll.setPreferredSize(new Dimension(340, 92));
        JPanel actionRow = new JPanel(new FlowLayout(FlowLayout.RIGHT, 6, 0));
        actionRow.add(includeEditor);
        actionRow.add(plan);
        actionRow.add(send);
        JPanel container = new JPanel();
        container.setLayout(new BoxLayout(container, BoxLayout.Y_AXIS));
        container.setBorder(JBUI.Borders.emptyTop(8));
        container.add(inputScroll);
        container.add(Box.createVerticalStrut(6));
        container.add(actionRow);
        return container;
    }

    private void bindActions() {
        refresh.addActionListener(event -> refreshContext(false));
        newThread.addActionListener(event -> runAsync(
            () -> bridge.createThread("Tâche JetBrains"),
            ignored -> refreshContext(true)
        ));
        threads.addActionListener(event -> {
            if (
                !replacingThreads
                && threads.getSelectedItem() instanceof BridgeModels.ThreadInfo thread
            ) {
                runAsync(
                    () -> bridge.selectThread(thread.threadId),
                    ignored -> refreshContext(true)
                );
            }
        });
        send.addActionListener(event -> submit("question"));
        plan.addActionListener(event -> submit("plan"));
    }

    private void submit(String mode) {
        String content = input.getText().trim();
        if (content.isEmpty()) {
            setStatus("Écrivez une demande avant l’envoi.", true);
            return;
        }
        BridgeModels.ThreadInfo thread =
            (BridgeModels.ThreadInfo) threads.getSelectedItem();
        BridgeModels.AgentInfo agent =
            (BridgeModels.AgentInfo) agents.getSelectedItem();
        BridgeModels.ModelInfo model =
            (BridgeModels.ModelInfo) models.getSelectedItem();
        List<BridgeModels.FileContext> files = includeEditor.isSelected()
            ? currentEditorContext()
            : List.of();
        append("Vous", content);
        input.setText("");
        setBusy(true);
        runAsync(
            () -> bridge.chat(
                content,
                thread == null ? null : thread.threadId,
                agent == null ? null : agent.id,
                model == null ? "auto" : model.id,
                mode,
                files
            ),
            result -> {
                append(
                    BridgeModels.safe(result.response.modelDisplay, "NeuraCo"),
                    BridgeModels.safe(result.response.message, "Réponse vide.")
                );
                setBusy(false);
                refreshContext(false);
            }
        );
    }

    private List<BridgeModels.FileContext> currentEditorContext() {
        VirtualFile[] selected = FileEditorManager.getInstance(project).getSelectedFiles();
        VirtualFile file = selected.length > 0 ? selected[0] : null;
        if (file == null || file.isDirectory()) return List.of();
        Document document = FileDocumentManager.getInstance().getDocument(file);
        if (document == null) return List.of();
        String content = document.getText();
        if (content.length() > 80_000) content = content.substring(0, 80_000);
        String relative = file.getPath();
        String base = project.getBasePath();
        if (base != null) {
            try {
                relative = Path.of(base).relativize(Path.of(file.getPath())).toString();
            } catch (RuntimeException ignored) {
                // An external file keeps its absolute path as explicit context.
            }
        }
        return List.of(new BridgeModels.FileContext(
            relative,
            content,
            file.getFileType().getName()
        ));
    }

    private void refreshContext(boolean renderMessages) {
        runAsync(bridge::getContext, next -> {
            projectLabel.setText(
                "Projet : "
                + BridgeModels.safe(next.project == null ? null : next.project.name, "—")
            );
            usageLabel.setText("Consommation : " + usageText(next.usage));
            rulesLabel.setText("Règles : " + rulesText(next.permissions));
            replacingThreads = true;
            replaceItems(threads, next.threads);
            selectActiveThread(next.threads);
            replacingThreads = false;
            replaceItems(agents, next.agents);
            replaceItems(models, next.models);
            if (renderMessages) renderConversation(next.activeThread);
            setStatus("Connecté à NeuraCo Desktop", false);
        });
    }

    private void selectActiveThread(List<BridgeModels.ThreadInfo> values) {
        values.stream()
            .filter(thread -> thread.active)
            .findFirst()
            .ifPresent(threads::setSelectedItem);
    }

    private void renderConversation(BridgeModels.Conversation conversation) {
        transcript.setText("");
        if (conversation == null || conversation.messages == null) return;
        for (BridgeModels.Message message : conversation.messages) {
            if ("system".equals(message.role)) continue;
            append(
                "user".equals(message.role)
                    ? "Vous"
                    : BridgeModels.safe(message.model, "NeuraCo"),
                BridgeModels.safe(message.content, "")
            );
        }
    }

    private static <T> void replaceItems(JComboBox<T> combo, List<T> values) {
        Object selected = combo.getSelectedItem();
        combo.removeAllItems();
        if (values != null) values.forEach(combo::addItem);
        if (selected == null) return;
        for (int index = 0; index < combo.getItemCount(); index++) {
            T item = combo.getItemAt(index);
            if (Objects.equals(item.toString(), selected.toString())) {
                combo.setSelectedIndex(index);
                break;
            }
        }
    }

    private static String rulesText(BridgeModels.PermissionInfo permissions) {
        if (permissions == null) return "indisponibles";
        String actions = permissions.allowedActions == null
            || permissions.allowedActions.isEmpty()
            ? "aucune action automatique"
            : String.join(", ", permissions.allowedActions);
        return BridgeModels.safe(permissions.mode, "manual") + " · " + actions;
    }

    private static String usageText(JsonObject usage) {
        if (usage == null) return "indisponible";
        try {
            String plan = value(usage, "plan", "label", "Compte");
            String remaining = value(
                usage,
                "windows",
                "monthly",
                "remaining",
                "—"
            );
            return plan + " · " + remaining + " crédits mensuels restants";
        } catch (RuntimeException error) {
            return "disponible dans NeuraCo Desktop";
        }
    }

    private static String value(
        JsonObject object,
        String first,
        String second,
        String fallback
    ) {
        JsonElement value = object.getAsJsonObject(first).get(second);
        return value == null ? fallback : value.getAsString();
    }

    private static String value(
        JsonObject object,
        String first,
        String second,
        String third,
        String fallback
    ) {
        JsonElement value = object.getAsJsonObject(first)
            .getAsJsonObject(second)
            .get(third);
        return value == null ? fallback : value.getAsString();
    }

    private void append(String author, String content) {
        transcript.append("\n" + author + "\n" + content.trim() + "\n");
        transcript.setCaretPosition(transcript.getDocument().getLength());
    }

    private void setBusy(boolean busy) {
        send.setEnabled(!busy);
        plan.setEnabled(!busy);
        newThread.setEnabled(!busy);
        setStatus(
            busy ? "NeuraCo travaille…" : "Connecté à NeuraCo Desktop",
            false
        );
    }

    private void setStatus(String message, boolean error) {
        status.setText(message);
        status.setForeground(error ? JBColor.RED : JBColor.GRAY);
    }

    private <T> void runAsync(CheckedSupplier<T> operation, UiConsumer<T> success) {
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                T result = operation.get();
                ApplicationManager.getApplication().invokeLater(() -> success.accept(result));
            } catch (Exception error) {
                if (error instanceof InterruptedException) {
                    Thread.currentThread().interrupt();
                }
                ApplicationManager.getApplication().invokeLater(() -> {
                    setBusy(false);
                    setStatus(
                        error.getMessage() == null
                            ? "Connexion locale NeuraCo impossible."
                            : error.getMessage(),
                        true
                    );
                });
            }
        });
    }

    @FunctionalInterface
    private interface CheckedSupplier<T> {
        T get() throws Exception;
    }

    @FunctionalInterface
    private interface UiConsumer<T> {
        void accept(T value);
    }
}
