package com.neura.neuraco;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

final class NeuraCoBridgeClientTest {
    @Test
    void preservesControlledDesktopErrors() {
        assertEquals(
            "NeuraCo Desktop est verrouillé.",
            NeuraCoBridgeClient.errorMessage(
                "{\"error\":\"NeuraCo Desktop est verrouillé.\"}",
                423
            )
        );
    }

    @Test
    void neverDisplaysRawHtmlErrors() {
        String message = NeuraCoBridgeClient.errorMessage(
            "<html><body>proxy failure</body></html>",
            502
        );
        assertTrue(message.contains("HTTP 502"));
        assertFalse(message.contains("<html>"));
    }
}
