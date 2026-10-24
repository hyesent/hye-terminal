package com.hye.terminal;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(ShellPlugin.class);
        registerPlugin(LinuxRuntimePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
