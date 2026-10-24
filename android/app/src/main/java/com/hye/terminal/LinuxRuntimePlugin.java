package com.hye.terminal;

import android.content.Context;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Adapter for the optional embedded Linux userspace SDK.
 * Reflection keeps the Capacitor plugin source independent from upstream package refactors;
 * all failures are surfaced to the UI rather than silently falling back to Android sh.
 */
@CapacitorPlugin(name = "HyeLinuxRuntime")
public class LinuxRuntimePlugin extends Plugin {
    private static final String TAG = "HyeLinuxRuntime";
    private final ExecutorService worker = Executors.newCachedThreadPool();
    private final ScheduledExecutorService poller = Executors.newSingleThreadScheduledExecutor();
    private final ConcurrentHashMap<String, LinuxProcess> processes = new ConcurrentHashMap<>();
    private final AtomicLong processSequence = new AtomicLong(1);
    private volatile String linuxHome = "";

    private static final class LinuxProcess {
        final String id;
        final String shellPid;
        final String command;
        final String cwd;
        final String logPath;
        final String exitMarker;
        volatile long logOffset = 0;
        final AtomicBoolean polling = new AtomicBoolean(false);
        volatile ScheduledFuture<?> pollTask;
        LinuxProcess(String id, String shellPid, String command, String cwd, String logPath, String exitMarker) {
            this.id = id; this.shellPid = shellPid; this.command = command; this.cwd = cwd; this.logPath = logPath; this.exitMarker = exitMarker;
        }
    }
    private volatile Object runtime;
    private volatile Object bridge;
    private volatile String state = "not-initialized";
    private volatile String error = "";

    @PluginMethod public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("state", state);
        result.put("ready", bridge != null);
        result.put("initialized", bridge != null);
        result.put("home", linuxHome);
        result.put("error", error);
        result.put("architecture", System.getProperty("os.arch", "unknown"));
        result.put("sdk", "libtermux-android (experimental upstream SDK)");
        result.put("activeProcesses", processes.size());
        call.resolve(result);
    }

    /** Snapshot of commands still being tracked, useful for restoring server/process controls in the UI. */
    @PluginMethod public void listProcesses(PluginCall call) {
        com.getcapacitor.JSArray items = new com.getcapacitor.JSArray();
        for (LinuxProcess process : processes.values()) {
            JSObject item = new JSObject();
            item.put("processId", process.id);
            item.put("pid", process.shellPid);
            item.put("command", process.command);
            item.put("cwd", process.cwd);
            item.put("logPath", process.logPath);
            items.put(item);
        }
        call.resolve(new JSObject().put("processes", items));
    }

    @PluginMethod public void install(PluginCall call) {
        if (bridge != null) {
            call.resolve(new JSObject().put("state", "ready").put("ready", true).put("initialized", true).put("home", linuxHome));
            return;
        }
        state = "installing";
        error = "";
        worker.execute(() -> {
            try {
                Context context = getContext();
                Class<?> libClass = findClass(
                    "com.libtermux.LibTermux",
                    "com.libtermux.core.LibTermux",
                    "com.libtermux.sdk.LibTermux"
                );
                Object builder = libClass.getMethod("builder", Context.class).invoke(null, context);
                invokeIfPresent(builder, "autoInstall", new Class<?>[]{boolean.class}, new Object[]{true});
                runtime = builder.getClass().getMethod("build").invoke(builder);
                runtime.getClass().getMethod("initializeBlocking").invoke(runtime);
                bridge = runtime.getClass().getMethod("getBridge").invoke(runtime);
                linuxHome = String.valueOf(bridge.getClass().getMethod("runOrThrow", String.class).invoke(bridge, "printf %s \"$HOME\"")).trim();
                state = "ready";
                JSObject result = new JSObject();
                result.put("state", state); result.put("ready", true); result.put("initialized", true); result.put("home", linuxHome);
                getActivity().runOnUiThread(() -> call.resolve(result));
            } catch (Throwable throwable) {
                Throwable cause = throwable.getCause() == null ? throwable : throwable.getCause();
                error = cause.getClass().getSimpleName() + ": " + String.valueOf(cause.getMessage());
                state = "failed";
                Log.e(TAG, "Embedded Linux runtime setup failed", cause);
                JSObject result = new JSObject();
                result.put("state", state); result.put("ready", false); result.put("initialized", false); result.put("error", error);
                getActivity().runOnUiThread(() -> call.reject("Linux runtime setup failed: " + error, cause instanceof Exception ? (Exception) cause : new Exception(cause)));
            }
        });
    }

    /** Import a file directly into the Linux filesystem instead of the separate Android host home. */
    @PluginMethod public void writeFile(PluginCall call) {
        if (bridge == null) { call.reject("Linux runtime is not initialized"); return; }
        String path = call.getString("path", "");
        String encoded = call.getString("base64", "");
        if (path.isEmpty()) { call.reject("File path is empty"); return; }
        worker.execute(() -> {
            try {
                String parent = path.contains("/") ? path.substring(0, path.lastIndexOf('/')) : linuxHome;
                String command = "mkdir -p " + shellQuote(parent) + " && printf '%s' " + shellQuote(encoded) +
                    " | base64 -d > " + shellQuote(path);
                bridge.getClass().getMethod("runOrThrow", String.class).invoke(bridge, command);
                getActivity().runOnUiThread(() -> call.resolve(new JSObject().put("path", path)));
            } catch (Throwable throwable) {
                Throwable cause = throwable.getCause() == null ? throwable : throwable.getCause();
                Exception failure = cause instanceof Exception ? (Exception) cause : new Exception(cause);
                getActivity().runOnUiThread(() -> call.reject("Could not import file into Linux: " + cause.getMessage(), failure));
            }
        });
    }

    /** Install real packages inside the embedded userspace via its own pkg manager. */
    @PluginMethod public void installPackages(PluginCall call) {
        if (bridge == null) { call.reject("Linux runtime is not initialized. Run hye runtime install first."); return; }
        com.getcapacitor.JSArray requested = call.getArray("packages");
        if (requested == null || requested.length() == 0) { call.reject("Provide at least one package name"); return; }
        StringBuilder command = new StringBuilder("pkg install -y");
        try {
            for (int i = 0; i < requested.length(); i++) {
                String name = requested.getString(i);
                if (name == null || !name.matches("[A-Za-z0-9+_.-]+")) {
                    call.reject("Invalid package name: " + name); return;
                }
                command.append(' ').append(name);
            }
        } catch (Exception e) { call.reject("Invalid package list: " + e.getMessage(), e); return; }
        final String installCommand = command.toString();
        worker.execute(() -> {
            try {
                Object raw = bridge.getClass().getMethod("runOrThrow", String.class).invoke(bridge, installCommand);
                JSObject payload = new JSObject();
                payload.put("stdout", raw == null ? "" : String.valueOf(raw));
                payload.put("stderr", "");
                payload.put("exitCode", 0);
                getActivity().runOnUiThread(() -> call.resolve(payload));
            } catch (Throwable throwable) {
                Throwable cause = throwable.getCause() == null ? throwable : throwable.getCause();
                error = cause.getClass().getSimpleName() + ": " + String.valueOf(cause.getMessage());
                Exception failure = cause instanceof Exception ? (Exception) cause : new Exception(cause);
                getActivity().runOnUiThread(() -> call.reject("Package installation failed: " + cause.getMessage(), failure));
            }
        });
    }

    /** Start a real Linux command asynchronously and poll its log so long-running servers stay alive. */
    @PluginMethod public void execute(PluginCall call) {
        final String command = call.getString("command", "").trim();
        final String cwd = call.getString("cwd", linuxHome).trim();
        if (command.isEmpty()) { call.reject("Command is empty"); return; }
        if (bridge == null) { call.reject("Linux runtime is not initialized. Run hye runtime install first."); return; }
        worker.execute(() -> {
            try {
                String id = "linux-" + System.currentTimeMillis() + "-" + processSequence.getAndIncrement();
                String safeId = id.replaceAll("[^A-Za-z0-9_-]", "_");
                String logPath = linuxHome + "/.hye-terminal-processes/" + safeId + ".log";
                String quotedLog = shellQuote(logPath);
                // Unique completion markers avoid mistaking normal command output for process status.
                // Group the launch so $! is the Bash PID rather than the whole setup command list.
                String exitMarker = "__HYE_EXIT_" + safeId + "__";
                String inner = "cd " + shellQuote(cwd.isEmpty() ? linuxHome : cwd) +
                    "; cdCode=$?; if [ \"$cdCode\" -ne 0 ]; then code=125; printf \"\\n" + exitMarker + ":%s\\n\" \"$code\" >> " + quotedLog +
                    "; exit \"$code\"; fi; " + command +
                    "; code=$?; printf \"\\n" + exitMarker + ":%s\\n\" \"$code\" >> " + quotedLog;
                String start = "mkdir -p " + shellQuote(linuxHome + "/.hye-terminal-processes") + " && : > " + quotedLog +
                    " && (bash -lc " + shellQuote(inner) + " >> " + quotedLog + " 2>&1 < /dev/null & echo $!)";
                Object raw = bridge.getClass().getMethod("runOrThrow", String.class).invoke(bridge, start);
                String pid = lastInteger(raw == null ? "" : String.valueOf(raw));
                if (pid.isEmpty()) throw new IllegalStateException("Linux runtime did not return a process ID: " + raw);
                LinuxProcess process = new LinuxProcess(id, pid, command, cwd, logPath, exitMarker);
                processes.put(id, process);
                JSObject payload = new JSObject().put("processId", id).put("cwd", cwd).put("command", command);
                getActivity().runOnUiThread(() -> call.resolve(payload));
                process.pollTask = poller.scheduleWithFixedDelay(() -> pollProcess(process), 500, 500, TimeUnit.MILLISECONDS);
            } catch (Throwable throwable) {
                Throwable cause = throwable.getCause() == null ? throwable : throwable.getCause();
                Exception failure = cause instanceof Exception ? (Exception) cause : new Exception(cause);
                getActivity().runOnUiThread(() -> call.reject("Could not start Linux command: " + cause.getMessage(), failure));
            }
        });
    }

    @PluginMethod public void kill(PluginCall call) {
        String id = call.getString("processId", "");
        LinuxProcess process = processes.get(id);
        if (process == null || bridge == null) { call.resolve(); return; }
        worker.execute(() -> {
            try {
                String pid = process.shellPid.replaceAll("[^0-9]", "");
                // Kill descendants first (for example npm -> node), then the command shell.
                String terminate = "kill_tree() { for child in $(ps -o pid= --ppid \"$1\" 2>/dev/null); do kill_tree \"$child\"; done; kill -TERM \"$1\" 2>/dev/null || true; }; " +
                    "kill_tree " + pid + " 2>/dev/null || { pkill -TERM -P " + pid + " 2>/dev/null || true; kill -TERM " + pid + " 2>/dev/null || true; }";
                bridge.getClass().getMethod("runOrThrow", String.class).invoke(bridge, terminate);
            } catch (Exception ignored) { }
            processes.remove(id);
            if (process.pollTask != null) process.pollTask.cancel(false);
            notifyListeners("exit", new JSObject().put("processId", id).put("exitCode", 130)
                .put("command", process.command).put("cwd", process.cwd));
            call.resolve();
        });
    }

    @PluginMethod public void killAll(PluginCall call) {
        if (bridge == null) { processes.clear(); call.resolve(); return; }
        worker.execute(() -> {
            for (LinuxProcess process : processes.values()) {
                try {
                    String pid = process.shellPid.replaceAll("[^0-9]", "");
                    String terminate = "kill_tree() { for child in $(ps -o pid= --ppid \"$1\" 2>/dev/null); do kill_tree \"$child\"; done; kill -TERM \"$1\" 2>/dev/null || true; }; " +
                        "kill_tree " + pid + " 2>/dev/null || { pkill -TERM -P " + pid + " 2>/dev/null || true; kill -TERM " + pid + " 2>/dev/null || true; }";
                    bridge.getClass().getMethod("runOrThrow", String.class).invoke(bridge, terminate);
                } catch (Exception ignored) { }
                if (process.pollTask != null) process.pollTask.cancel(false);
                notifyListeners("exit", new JSObject().put("processId", process.id).put("exitCode", 130)
                    .put("command", process.command).put("cwd", process.cwd));
            }
            processes.clear();
            getActivity().runOnUiThread(call::resolve);
        });
    }

    private void pollProcess(LinuxProcess process) {
        if (!process.polling.compareAndSet(false, true) || bridge == null) return;
        try {
            long offset = process.logOffset;
            String script = "if [ -f " + shellQuote(process.logPath) + " ]; then " +
                "n=$(wc -c < " + shellQuote(process.logPath) + "); " +
                "if [ \"$n\" -gt " + offset + " ]; then tail -c +$((" + offset + "+1)) " + shellQuote(process.logPath) +
                " | head -c $((n-" + offset + ")); fi; " +
                "printf '\\n__HYE_META__:%s:' \"$n\"; " +
                "grep -o " + shellQuote(process.exitMarker + ":[0-9]*") + " " + shellQuote(process.logPath) + " | tail -n 1 | cut -d: -f2; printf '\\n'; " +
                "else printf '\\n__HYE_META__:0:\\n'; fi";
            Object raw = bridge.getClass().getMethod("runOrThrow", String.class).invoke(bridge, script);
            String response = raw == null ? "" : String.valueOf(raw);
            int meta = response.lastIndexOf("__HYE_META__:");
            String delta = meta >= 0 ? response.substring(0, meta) : response;
            if (delta.endsWith("\n")) delta = delta.substring(0, delta.length() - 1); // metadata separator
            Integer exitCode = null;
            if (meta >= 0) {
                String metadata = response.substring(meta + "__HYE_META__:".length()).trim();
                String[] fields = metadata.split(":", -1);
                try { process.logOffset = Long.parseLong(fields[0]); } catch (Exception ignored) { }
                if (fields.length > 1 && !fields[1].isEmpty()) {
                    try { exitCode = Integer.parseInt(fields[1]); } catch (Exception ignored) { }
                }
            }
            int marker = delta.lastIndexOf(process.exitMarker + ":");
            if (marker >= 0) delta = delta.substring(0, marker);
            if (!delta.isEmpty()) {
                notifyListeners("output", new JSObject().put("processId", process.id).put("stream", "stdout")
                    .put("data", delta).put("command", process.command).put("cwd", process.cwd));
            }
            if (exitCode != null) {
                processes.remove(process.id);
                if (process.pollTask != null) process.pollTask.cancel(false);
                notifyListeners("exit", new JSObject().put("processId", process.id).put("exitCode", exitCode)
                    .put("command", process.command).put("cwd", process.cwd));
            }
        } catch (Throwable throwable) {
            Log.w(TAG, "Linux process polling failed", throwable);
        } finally { process.polling.set(false); }
    }

    private static String shellQuote(String value) { return "'" + String.valueOf(value).replace("'", "'\\''") + "'"; }
    private static String lastInteger(String value) {
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("(?m)^\\s*(\\d+)\\s*$").matcher(value);
        String result = ""; while (matcher.find()) result = matcher.group(1); return result;
    }

    /** Run a diagnostic or short Linux command. */
    @PluginMethod public void run(PluginCall call) {
        String command = call.getString("command", "").trim();
        if (command.isEmpty()) { call.reject("Command is empty"); return; }
        if (bridge == null) { call.reject("Linux runtime is not initialized. Run hye runtime install first."); return; }
        worker.execute(() -> {
            try {
                // The documented Java API returns command output as a String from
                // TermuxBridge.runOrThrow(String), not a result object with stdout fields.
                Object raw = bridge.getClass().getMethod("runOrThrow", String.class).invoke(bridge, command);
                JSObject payload = new JSObject();
                payload.put("stdout", raw == null ? "" : String.valueOf(raw));
                payload.put("stderr", "");
                payload.put("exitCode", 0);
                getActivity().runOnUiThread(() -> call.resolve(payload));
            } catch (Throwable throwable) {
                Throwable cause = throwable.getCause() == null ? throwable : throwable.getCause();
                Exception failure = cause instanceof Exception ? (Exception) cause : new Exception(cause);
                getActivity().runOnUiThread(() -> call.reject("Linux command failed: " + cause.getMessage(), failure));
            }
        });
    }

    private static Class<?> findClass(String... names) throws ClassNotFoundException {
        for (String name : names) {
            try { return Class.forName(name); } catch (ClassNotFoundException ignored) { }
        }
        throw new ClassNotFoundException("Could not find LibTermux SDK entry point; check the installed SDK version");
    }

    private static void invokeIfPresent(Object target, String name, Class<?>[] types, Object[] values) throws Exception {
        try { target.getClass().getMethod(name, types).invoke(target, values); }
        catch (NoSuchMethodException ignored) { }
    }

    private static Object readObject(Object target, String... names) {
        if (target == null) return null;
        for (String name : names) {
            try {
                if (name.startsWith("get")) return target.getClass().getMethod(name).invoke(target);
                try { return target.getClass().getField(name).get(target); } catch (NoSuchFieldException ignored) { }
                String getter = "get" + Character.toUpperCase(name.charAt(0)) + name.substring(1);
                try { return target.getClass().getMethod(getter).invoke(target); } catch (NoSuchMethodException ignored) { }
            } catch (Exception ignored) { }
        }
        return null;
    }

    private static String readValue(Object target, String field, String getter) {
        Object value = readObject(target, field, getter);
        return value == null ? "" : String.valueOf(value);
    }

    @Override protected void handleOnDestroy() {
        worker.shutdownNow();
        poller.shutdownNow();
        processes.clear();
        super.handleOnDestroy();
    }
}
