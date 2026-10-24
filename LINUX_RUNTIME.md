# HYE Terminal — real local Linux execution

## What this stage implements

- The native Capacitor adapter initializes the `libtermux-android` SDK and returns the embedded Linux `$HOME` path.
- The app remembers that Linux setup was requested and reinitializes the SDK on later launches.
- After the runtime is ready, ordinary commands (`ls`, `grep`, `bash`, `git`, `node`, `npm`, `python`, etc.) are routed into the Linux userspace without an `hye` prefix.
- `cd` and `pwd` use the Linux home/current directory when Linux is active.
- Linux commands are started asynchronously in the Linux userspace. HYE polls their output log, streams new output into the existing terminal block, reports exit codes, and offers best-effort Ctrl+C termination. Process IDs are captured from the actual Bash launch, completion markers are unique per process, and termination attempts to stop descendant processes as well as the shell. This is intended to support long-running commands such as `npm run dev` or `python -m http.server 8080` while HYE is open; this still requires on-device verification.
- Package installation uses the real Linux package manager directly, for example `pkg install git nodejs python curl`; there is no HYE wrapper required.
- The Android host shell remains available before the Linux runtime is installed; it is not represented as a full Linux distribution.
- Command execution does not use a remote HYE backend.

## Important limits

- The upstream `libtermux-android` project describes itself as experimental and not production-ready.
- The Linux process adapter still uses log polling rather than a native PTY session. This is not yet a persistent interactive Bash session: shell variables and shell state do not automatically persist between separate commands, and fully interactive terminal applications (for example editors, `top`, REPLs requiring a live TTY, password prompts) still need the SDK's real PTY/session API integrated into the React terminal.
- Ctrl+C is best-effort process-tree termination; detached child processes may survive depending on the process tree and Android userspace.
- Package installation output currently arrives after the package-manager call finishes rather than streaming its progress.
- The upstream SDK artifact URLs documented by the project returned 404 in earlier CI attempts. CI now checks out the upstream source and publishes the core plus all four bootstrap artifacts (ARM64, ARM 32-bit, x86_64, and x86) to the runner-local Maven repository before building HYE Terminal. This workflow change has not yet been confirmed by a successful GitHub Actions run or a physical-device test.
- The Android build is configured to produce four ABI-specific APKs and one universal APK. Choose `HyeTerminal-arm64-v8a.apk` for most modern Android phones, `HyeTerminal-armeabi-v7a.apk` for 32-bit ARM phones, or the x86 variant for compatible Intel-based devices. The universal APK includes all four architectures but will be larger.
- Supporting an ABI at packaging time does not guarantee every device can run the Linux environment: the upstream SDK is experimental, and runtime bootstrap selection and native binary execution must be tested on real devices for each ABI.

## Device acceptance checklist

1. Run the GitHub Actions workflow; it builds the upstream LibTermux core and all four ABI bootstrap modules from source and publishes them to the runner-local Maven repository before compiling the app.
2. Install the matching APK on ARM64, ARM 32-bit, x86_64, and x86 test devices/emulators where available, then run `hye runtime install` once on each.
3. Run ordinary commands without the `hye linux` prefix: `uname -a`, `bash --version`, `pwd`, `ls -la`.
4. Install tools with `pkg install git nodejs python curl`, then verify `git --version`, `node --version`, `npm --version`, and `python --version` as ordinary commands.
5. Start a long-running command such as `python -m http.server 8080`, verify output and process lifetime, then stop it with Ctrl+C.
6. Run a project server with `npm run dev`, verify its URL is reachable from the phone, and verify termination.
7. Restart HYE and confirm Linux initializes and the Linux working directory is restored correctly.
8. Confirm no HYE-owned backend is contacted and that the environment works offline after required packages are installed.

## Upstream

- https://github.com/libtermux/libtermux-android

## Local development servers

The process launcher keeps long-running commands running in the embedded Linux userspace and polls their log files while HYE Terminal remains alive. Use ordinary Linux commands, for example:

```bash
python -m http.server 8080 --bind 127.0.0.1
npm run dev -- --host 0.0.0.0
node server.js
```

Open a loopback-bound server on the same phone at `http://127.0.0.1:8080`. For a LAN-accessible dev server, bind to `0.0.0.0` and use the phone's Wi-Fi IP address from another device; Android firewall/network settings may still affect access. Keep the HYE app open while testing. App force-stop, OS process reclamation, or device restart can stop servers; this stage does not claim an Android foreground-service guarantee. Ctrl+C is implemented as best-effort process-tree termination. Check the terminal's process-exit output to confirm the server stopped.

`HyeLinuxRuntime.status()` now reports the count of tracked processes, and the native `listProcesses()` method returns their IDs, PIDs, commands, working directories, and log paths for process-control UI integration.
