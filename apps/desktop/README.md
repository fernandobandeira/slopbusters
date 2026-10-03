# Slopbusters desktop

Run `pnpm desktop:dev` from the repository root to build the reviewer and open it
in Electron. `pnpm desktop:start` opens the last build. `pnpm desktop:pack` creates
an unpacked application in `apps/desktop/release`; `pnpm --dir apps/desktop dist`
creates installers for the current platform. Installer signing requires your own
platform signing configuration. The first desktop build downloads the pinned
Electron runtime if its installation step has not already done so.
The application and packaged icons use the existing `assets/slopbusters.png`
logo. Electron Builder converts this PNG into each platform's native icon format.

Electron starts the local API in its main process using its embedded Node runtime
and SQLite. The renderer is sandboxed and receives no Node or filesystem bridge.
Review data lives in `reviewer.sqlite` under Electron's `userData` directory
(`~/Library/Application Support/Slopbusters` on macOS). Each launch uses an
available loopback port. GitHub and AI tools continue using your terminal's
installed and authenticated `gh`, `codex`, or `claude` commands; on macOS the app
reads PATH from your login shell so Finder launches can find those commands.

`pnpm desktop:smoke` builds the app and opens two isolated hidden windows to verify
the real renderer, permission sandbox, SQLite runtime, local preferences API, and
theme persistence across app restarts. It uses a temporary data directory and
removes it afterward. A synthetic source fixture checks context expansion,
source browsing, definitions and references in the real renderer without
contacting a provider. The test also loads a bundled Python grammar through
WebAssembly. Linux CI needs a display server, for example `xvfb-run -a
pnpm desktop:smoke`.

Closing the window or quitting waits for review changes to reach SQLite. If a
save fails, the app lets you keep it open or close without saving those changes.
The window blocks edits while closing and restores input when you keep it open.
The smoke test also changes a preference through this quit handshake and checks
that input is blocked during the save and the next app launch reads it.
Pass `--executable=/absolute/path/to/Slopbusters` to the smoke script to run the
same checks against a packaged executable instead of the development build.

The packaged app includes the reviewer license, dependency notices, Electron and
Chromium licenses, and the T3 Code license emitted by the renderer build. The
source parsers and their upstream notices are bundled for offline analysis.
single-line T3 credit appears at the bottom of the repository README.
