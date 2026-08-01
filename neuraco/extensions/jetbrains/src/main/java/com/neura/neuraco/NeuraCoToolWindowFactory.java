package com.neura.neuraco;

import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.ui.content.Content;
import com.intellij.ui.content.ContentFactory;
import org.jetbrains.annotations.NotNull;

public final class NeuraCoToolWindowFactory implements ToolWindowFactory, DumbAware {
    @Override
    public void createToolWindowContent(
        @NotNull Project project,
        @NotNull ToolWindow toolWindow
    ) {
        NeuraCoToolWindowPanel panel = new NeuraCoToolWindowPanel(project);
        Content content = ContentFactory.getInstance()
            .createContent(panel, "", false);
        toolWindow.getContentManager().addContent(content);
    }
}
