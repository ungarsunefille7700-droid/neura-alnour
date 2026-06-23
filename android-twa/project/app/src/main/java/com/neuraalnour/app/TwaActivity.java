package com.neuraalnour.app;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Bundle;
import androidx.browser.customtabs.CustomTabsIntent;

public class TwaActivity extends android.app.Activity {

    private static final String DEFAULT_URL = "https://noor-dev.preview.emergentagent.com";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);

        CustomTabsIntent customTabsIntent = new CustomTabsIntent.Builder()
            .setShowTitle(true)
            .build();

        customTabsIntent.launchUrl(this, Uri.parse(DEFAULT_URL));
        finish();
    }
}
