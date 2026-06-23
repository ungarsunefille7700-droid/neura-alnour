package com.neuraalnour.app;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;

public class LauncherActivity extends android.app.Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        new Handler().postDelayed(() -> {
            startActivity(new Intent(this, TwaActivity.class));
            finish();
        }, 300);
    }
}
