package com.hye.terminal;

import android.system.Os;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.FileOutputStream;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import android.util.Base64;

/** Native on-device process manager. This executes Android-host commands, not a Linux distro yet. */
@CapacitorPlugin(name = "HyeShell")
public class ShellPlugin extends Plugin {
    private final ConcurrentHashMap<String, RunningProcess> processes = new ConcurrentHashMap<>();
    private final AtomicInteger sequence = new AtomicInteger(1);
    private File root;
    private File tmp;

    private static final class RunningProcess {
        final String id;
        final String command;
        final String cwd;
        final long startedAt;
        final Process process;
        final BufferedWriter stdin;
        RunningProcess(String id, String command, String cwd, Process process) throws Exception {
            this.id = id; this.command = command; this.cwd = cwd;
            this.startedAt = System.currentTimeMillis(); this.process = process;
            this.stdin = new BufferedWriter(new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
        }
    }

    @Override public void load() {
        root = new File(getContext().getFilesDir(), "hye-home");
        tmp = new File(root, "tmp");
        new File(root, "projects").mkdirs();
        new File(root, "bin").mkdirs();
        tmp.mkdirs();
    }

    @PluginMethod public void home(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("home", root.getAbsolutePath());
        ret.put("projects", new File(root, "projects").getAbsolutePath());
        ret.put("platform", "android-local-shell");
        ret.put("runtime", "android-host");
        call.resolve(ret);
    }

    @PluginMethod public void checkDirectory(PluginCall call) {
        String requested = call.getString("path", root.getAbsolutePath());
        try {
            File candidate = new File(requested).isAbsolute() ? new File(requested) : new File(root, requested);
            String base = root.getCanonicalPath();
            String canonical = candidate.getCanonicalPath();
            if (!canonical.equals(base) && !canonical.startsWith(base + File.separator)) {
                call.reject("Path must stay inside terminal home"); return;
            }
            if (!candidate.isDirectory()) { call.reject("Not a directory: " + canonical); return; }
            call.resolve(new JSObject().put("path", canonical));
        } catch (Exception e) { call.reject("Could not resolve directory: " + e.getMessage(), e); }
    }

    @PluginMethod public void writeFile(PluginCall call) {
        String requested = call.getString("path", "");
        String encoded = call.getString("base64", "");
        if (requested.isEmpty()) { call.reject("File path is empty"); return; }
        try {
            File target = new File(requested).isAbsolute() ? new File(requested) : new File(root, requested);
            String base = root.getCanonicalPath();
            String canonical = target.getCanonicalPath();
            if (!canonical.equals(base) && !canonical.startsWith(base + File.separator)) {
                call.reject("File path must stay inside terminal home"); return;
            }
            File parent = target.getParentFile();
            if (parent == null || (!parent.exists() && !parent.mkdirs())) { call.reject("Could not create parent directory"); return; }
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            try (FileOutputStream out = new FileOutputStream(target)) { out.write(bytes); }
            call.resolve(new JSObject().put("path", canonical).put("bytes", bytes.length));
        } catch (Exception e) { call.reject("Could not write file: " + e.getMessage(), e); }
    }

    @PluginMethod public void execute(PluginCall call) {
        final String command = call.getString("command", "").trim();
        final String requestedCwd = call.getString("cwd", root.getAbsolutePath());
        if (command.isEmpty()) { call.reject("Command is empty"); return; }
        File cwd = new File(requestedCwd).isAbsolute() ? new File(requestedCwd) : new File(root, requestedCwd);
        try {
            String canonicalRoot = root.getCanonicalPath();
            String canonicalCwd = cwd.getCanonicalPath();
            if (!canonicalCwd.equals(canonicalRoot) && !canonicalCwd.startsWith(canonicalRoot + File.separator)) {
                call.reject("Working directory must stay inside terminal home: " + canonicalRoot); return;
            }
            if (!cwd.isDirectory()) { call.reject("Directory does not exist: " + canonicalCwd); return; }
            String id = String.valueOf(sequence.getAndIncrement());
            ProcessBuilder pb = new ProcessBuilder("/system/bin/sh", "-c", command);
            pb.directory(cwd);
            pb.redirectErrorStream(false);
            Map<String, String> env = pb.environment();
            env.put("HOME", root.getAbsolutePath());
            env.put("TMPDIR", tmp.getAbsolutePath());
            env.put("PREFIX", root.getAbsolutePath());
            env.put("PWD", canonicalCwd);
            env.put("SHELL", "/system/bin/sh");
            env.put("PATH", root.getAbsolutePath() + "/bin:/system/bin:/system/xbin:/product/bin:/vendor/bin");
            env.put("TERM", "xterm-256color");
            env.put("COLORTERM", "truecolor");
            env.put("LANG", "C.UTF-8");
            Process process = pb.start();
            RunningProcess running = new RunningProcess(id, command, canonicalCwd, process);
            processes.put(id, running);
            call.resolve(new JSObject().put("processId", id).put("cwd", canonicalCwd).put("command", command));
            Thread out = new Thread(() -> pump(running, "stdout"), "hye-out-" + id);
            Thread err = new Thread(() -> pump(running, "stderr"), "hye-err-" + id);
            Thread wait = new Thread(() -> waitFor(running), "hye-wait-" + id);
            out.setDaemon(true); err.setDaemon(true); wait.setDaemon(true);
            out.start(); err.start(); wait.start();
        } catch (Exception e) { call.reject("Local command failed: " + e.getMessage(), e); }
    }

    private void pump(RunningProcess running, String stream) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                stream.equals("stdout") ? running.process.getInputStream() : running.process.getErrorStream(), StandardCharsets.UTF_8))) {
            char[] buffer = new char[2048]; int count;
            while ((count = reader.read(buffer)) >= 0) {
                if (count == 0) continue;
                JSObject data = new JSObject();
                data.put("processId", running.id); data.put("stream", stream);
                data.put("data", new String(buffer, 0, count)); data.put("command", running.command); data.put("cwd", running.cwd);
                notifyListeners("output", data);
            }
        } catch (Exception ignored) { }
    }

    private void waitFor(RunningProcess running) {
        int exitCode = -1;
        try { exitCode = running.process.waitFor(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        processes.remove(running.id);
        JSObject done = new JSObject();
        done.put("processId", running.id); done.put("exitCode", exitCode);
        done.put("command", running.command); done.put("cwd", running.cwd);
        notifyListeners("exit", done);
    }

    @PluginMethod public void writeInput(PluginCall call) {
        String id = call.getString("processId", "");
        String data = call.getString("data", "");
        RunningProcess running = processes.get(id);
        if (running == null) { call.reject("No running process with id " + id); return; }
        try { synchronized (running.stdin) { running.stdin.write(data); running.stdin.flush(); } call.resolve(); }
        catch (Exception e) { call.reject("Could not write to process: " + e.getMessage(), e); }
    }

    @PluginMethod public void listProcesses(PluginCall call) {
        JSArray items = new JSArray();
        for (RunningProcess p : processes.values()) {
            items.put(new JSObject().put("processId", p.id).put("command", p.command).put("cwd", p.cwd).put("startedAt", p.startedAt));
        }
        call.resolve(new JSObject().put("processes", items));
    }

    @PluginMethod public void kill(PluginCall call) {
        String id = call.getString("processId", "");
        RunningProcess running = processes.get(id);
        if (running != null) {
            running.process.destroy();
            try { if (!running.process.waitFor(300, java.util.concurrent.TimeUnit.MILLISECONDS)) running.process.destroyForcibly(); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); running.process.destroyForcibly(); }
        }
        call.resolve();
    }

    @PluginMethod public void killAll(PluginCall call) {
        for (RunningProcess running : processes.values()) {
            running.process.destroy();
            try { if (!running.process.waitFor(200, java.util.concurrent.TimeUnit.MILLISECONDS)) running.process.destroyForcibly(); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); running.process.destroyForcibly(); }
        }
        call.resolve();
    }
}
