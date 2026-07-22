# Claude Cockpit

> A local control tool for observing and controlling multiple Claude Code sessions from a single dashboard, organized **by project and by role**.
> Instead of building a new terminal multiplexer, it is **a thin orchestration layer laid on top of wmux**.

- **Status**: Live — the dashboard attaches to a real wmux instance and works live, all the way from project lifecycle, per-session spawning, and live detection of whether claude is running, to **session activity badges, model/effort chips**, an active port map (**server ON/OFF**), and a feature inventory
- **Environment**: **Windows 11 · wmux** · Claude Code · Node 20+ · **zero npm runtime dependencies**
- **Canonical system**: `cockpit/` (the old `teamctl/` was retired in a rewrite — an untracked leftover; do not rewire it)

![ClaudeCockpit dashboard overview](screenshot/overview.png)

*Single-screen control: project cards (in progress / waiting / closed) · the 3-step session flow (○ not connected → [＋ Activate session] → [▶ Run Claude]) · active port map · feature inventory*

---

## ⬇️ Download · Run

### 📥 [Download the latest release][releases] — currently **v0.3.0**

1. Download **[`ClaudeCockpit-v0.3.0.zip`][zip]** directly → unzip
2. Run — double-click **`ClaudeCockpit.exe`** (if it is blocked, use `start.cmd`)
3. **wmux** is ensured automatically → server → the dashboard opens in your browser (`http://127.0.0.1:7420/`)

> **Requirements**: Node.js 20+ · Claude Code (the `claude` command) · **wmux**. **No npm packages to install** (zero runtime dependencies).
> If this is your first time, read [Manual.md](Manual.md) together with the [visual guide](ClaudeCockpit-Guide.html).

---

## 🆕 Update — 2026-07-19 · [v0.3.0][zip]

In one line: **Cockpit has crossed over to macOS, and the activity hook attaches itself.** The same dashboard runs on both Windows (wmux) and macOS (cmux), and the activity badges do not quietly die when you switch PCs or move the repo. Observation and control are still entirely local measurements, so **Claude token consumption is 0**.

**1. macOS (cmux) support — cross-platform** (new)

Cockpit, once Windows-only, now runs unchanged on macOS. A **cmux** driver was attached beneath the mux facade — providing a darwin path for live claude-running detection, the active port map, session jumps, opening folders, and even cold boot. The launcher is **`ClaudeCockpit_cmux.command`** (double-click), and for the multiplexer it automatically ensures the cmux app in `/Applications`. The dashboard is unaware of the platform and only follows the `mux` contract handed over by the server (`ownsApp`·`canOpenWeb`), so behaviors like [⏻ Shut down] and the git chip change on their own to fit the OS.

**2. Automatic activity hook install · repair** (FS-7)

When the server comes up, it **actually checks** whether the activity hook is registered to this repo's path, and if it is not installed (first run on a PC) or points to an old path (repo moved or renamed), it **automatically re-registers** `~/.claude/settings.json` to the current path (idempotent · non-blocking · creates a backup). It used to judge "installed" from the filename alone, so a hook at an old path would quietly die; now it compares by **absolute path**, eliminating that blind spot. Of course, the one-click **[🪝 Install hook]** on the dashboard banner is still there as a final fallback.

**3. workspace git tracking** (FS-21)

Cockpit's **only background loop** (2s). When you switch workspaces directly in wmux with `Ctrl+1~9`, it moves that repository's page into the multiplexer's built-in browser panel **just once** (so that a reload every tick does not wipe out your scroll position or login). Toggle it with the dashboard's [↺ git tracking] chip (`POST /follow` · on by default). There is no pipe load — it shares the TTL cache of the dashboard's polling. (On cmux, which cannot open a built-in web panel, it falls back to the default browser.)

**4. macOS port shutdown path stabilized**

The darwin shutdown path for an active port's **[✕]** was ordered as an `lsof` rescan (freshListener) → re-verify ownership → `killPid`, matching the same "re-aim before firing" safety friction as Windows to macOS as well. In addition, the `.command` launcher was pinned to **eol=lf** — nailing down at the release-packaging stage the problem where a CRLF shebang (`/bin/bash\r`) blocked execution on macOS entirely.

**5. Token consumption is still 0**

The dashboard only reads local files already accumulated on my computer — the activity badges and model/effort chips are state files left by hooks, and git tracking is local repository state. None of the indicators added this time call the API. The one path where tokens ever flow is, as always, just **[▶ Run Claude]** — [see: Claude token consumption](#note-claude-token-consumption)

> 📁 **Past updates** — [2026-07-15 · activity badges · model/effort chips · server ON/OFF · usage withdrawn](updates/2026-07-15.md)

---

## 📖 Where to start reading

| I am… | Read this first |
|---|---|
| **new to this** | **[Manual.md](Manual.md)** (beginner's manual) → **[ClaudeCockpit-Guide.html](ClaudeCockpit-Guide.html)** (visual guide with screen examples) |
| **needing a summary to keep on my desk** | **[ClaudeCockpit-Cheatsheet.html](ClaudeCockpit-Cheatsheet.html)** (printable single page · `Ctrl+P`) |
| **wanting the details of features and APIs** | **[Tech.md](Tech.md)** (feature specification — every feature, endpoint, and rule) |
| **having a problem or a suggestion** | Submit everything through the single **[contact form][form]** (1 minute) |

---

## Why we build this

When you run many tasks at once with Claude Code, terminals scatter and it becomes hard to tell which session of which project is currently running and what it is doing.

**Target**: solo developers and freelancers running multiple projects (or multiple clients) in parallel.

**Three core values**

1. **Project lifecycle control** — projects are listed as **waiting / in progress / closed**, and only an activated project opens as a wmux workspace. Sessions are opened one per role (individual spawn), and shutdown has only two paths, individual/all (no automatic shutdown).
2. **Judgment without jumping** — without entering a session, you see **whether claude is running + activity (in progress / waiting / awaiting input)** as a badge, and jump into wmux only when intervention is needed.
3. **Declarative · isolated operation** — the `root/<project>/project.json` folder declaration is the truth. Each project carries its own git and CLAUDE.md inside `ops/`, keeping it **isolated** from cockpit policy.

---

## Quick start

**Double-click `ClaudeCockpit.exe`** — ensures wmux → server → reconverges active projects → opens the dashboard in your default browser. It is idempotent, so it is safe to click several times (if it is blocked, use `start.cmd`).

Directly via CLI:

```bash
node cockpit/bin/cockpit.js boot          # cold boot (same as above)
node cockpit/bin/cockpit.js serve          # server only (default port 7420)
node cockpit/bin/cockpit.js boot --setup   # re-specify the wmux install path
```

Once the dashboard opens: **[＋ New project]** → **[▶ Activate]** → for each role **[＋ Activate session]** → **[▶ Run Claude]**.
(For detailed illustrated explanations, see [Manual.md](Manual.md) / the [visual guide](ClaudeCockpit-Guide.html))

---

## 💬 Contact

If you have a bug, question, or suggestion, we take them all **through a single contact form** (1 minute).

### 👉 [Open the contact form][form]

For fast handling, please include in the form — **type (bug/question/request) · app version · Windows version · details**, and for a bug, **the last `[wmux✗]` line from the server console** (a big help for diagnosing the cause).

---

## Core features

| Category | Feature |
|---|---|
| **Observation** | Project cards (waiting / in progress / closed) · **live claude-running detection** (on/off/unknown) · **session activity badges** (⏳ in progress / ⌛ waiting / ⚠ awaiting input — Claude hook) · **model/effort chips** (◆ — measured by hook) · session drawer (status · working folder · feature inventory · jump · folder · deactivate session) · git chip (remote web link) · active port map (project attribution) · Global feature inventory · unconnected (external) sessions · central event log |
| **Action** | Create/link a project / `＋ git address` (clone) · add/remove roles · `▶ Activate` (workspace only, no session spawn) · `＋ Activate session` (individual spawn per role) · `＋ Activate all sessions` (all missing) · `▶ Run Claude` (skipped if already running) · `↗ Open session` (jump into wmux) · `Deactivate session` (individual) · `Deactivate` (all · with confirmation — also stops attributed server listeners) · `Archive`/`Resume` · `＋ Link` · `＋ Remote` (git clone/connect into ops) · `＋ Server` (declare start command) → `▶ Start server` (sent to the role pane) · active port `✕` (stop listener · with confirmation) |
| **Operation** | Cold-boot exe · automatic discovery of the wmux location · automatic reconvergence of active on boot · **wmux command console logging** (`[wmux→]`/`[wmux✗]` diagnostics) · offline/demo badge distinction |

> A session is opened in **3 steps**: `○ not connected` → `[＋ Activate session]` → confirm connection → `[▶ Run Claude]`. Activating only opens the room; it does not auto-create a session.

---

## Concept mapping

| Concept | Actual thing |
|---|---|
| Project | wmux workspace + `root/<project>/project.json` declaration |
| Role (session) | an agent in a pane within the workspace (starts as a terminal → switch to claude via `▶`) |
| ops | the one fixed role per project (`root/<project>/ops/` — **the git repository, deployment, and operations baseline**) |
| Administrator | the HTML dashboard (`cockpit/dashboard.html`, default browser) |

---

## Architecture

```
root/<project>/project.json (desired · the folder is the truth) ──lifecycle──▶ wmux (actual)
      activate=ensure workspace · spawn=individual spawn per role · killSession/deactivate=explicit shutdown

Browser dashboard ── fetch(127.0.0.1:7420 + token) ──▶ cockpit serve (src/server.js · buildState)
       ├─ mux.js    (single gateway to the multiplexer — state cache · normalization · per-platform driver selection)
       │    └─ mux/wmux.js (win32 · direct pipe) · mux/cmux.js (macOS · cmux CLI) — command console logging
       ├─ proc.js   (live detection of claude running/stopped process)
       ├─ activity.js  (session activity — reads Claude Code hook state)
       ├─ ports·caps·git        (on-demand probes · non-blocking cache)
       └─ log.js    (central event log JSONL)

Claude Code hook (bin/activity-hook.mjs) ──▶ cockpit/workspace/activity/*.json ──▶ activity.js
```

Core data contract: `GET /api/state = { projects, unlinked, ports }`. For details, see [Tech.md](Tech.md).

---

## Folder structure

```
├─ cockpit/                     # canonical system
│  ├─ dashboard.html            #   dashboard (single file · inline JS · zero dependencies)
│  ├─ bin/cockpit.js            #   CLI: serve · boot
│  ├─ bin/activity-hook.mjs     #   Claude Code hook runtime + global settings install/remove
│  ├─ src/*.js                  #   registry·mux·lifecycle·proc·activity·log·ports·caps·git·server
│  ├─ src/mux/                  #   multiplexer drivers: wmux.js(win32) · cmux.js(macOS)
│  └─ workspace/                #   runtime (config·logs·activity) — gitignore
├─ root/                        # project declarations (folder = truth): <project>/project.json · ops/(git) · <role>/
├─ ClaudeCockpit.exe · start.cmd · launcher/   # cold-boot launcher
├─ README.md                    # (this document) intro · documentation hub
├─ Manual.md                    # beginner's user manual
├─ ClaudeCockpit-Guide.html     # visual guide (screen examples + annotations)
├─ ClaudeCockpit-Cheatsheet.html# printable single-page cheatsheet
├─ Tech.md                      # feature specification (every feature · API · rules)
└─ updates/                     # past update records (by date) — the latest is at the top of the README
```

---

## Principles

- **No reinvention** — PTY, rendering, and detach are all handled by wmux. Cockpit only observes and converges.
- **Minimal dependencies** — only Node built-in modules + the wmux/git/claude CLIs. Zero runtime npm dependencies.
- **Security** — the server is `127.0.0.1` + token only, with remote access as a non-goal. `.env` values are neither stored nor displayed (only their existence).
- **Safe friction for destructive actions** — session shutdown has only two paths, individual/all, both with confirmation. No automatic shutdown. **No undo.**
- **Graceful degradation** — a demo/offline badge when wmux is down, and indicators are skipped when a probe fails. No probe blocks polling.
- **Project isolation** — `root/<project>/` is an independent project unrelated to cockpit. **git lives only in `ops/`**, and with its own CLAUDE.md it does not inherit cockpit's rules.

---

## Note: Claude token consumption

The dashboard's **observation and control are entirely local operations, so they do not consume Claude tokens.** Polling, drawers, and the feature inventory read only the wmux pipe and local files. The activity badges and model/effort chips also merely read local state files left by the Claude Code hook.

The only path where tokens are involved is **[▶ Run Claude]**, and even that only *starts* claude (the startup itself makes no API call — tokens begin from the moment you give that session its first prompt). "We do not build a structure where every poll costs tokens" is a design principle.

---

## Documentation map (full)

| Document | Audience | Contents |
|---|---|---|
| [Manual.md](Manual.md) | users (beginners) | how to start · how to read the screen · the 3-step session flow · FAQ |
| [ClaudeCockpit-Guide.html](ClaudeCockpit-Guide.html) | users | a visual guide reproducing screen examples + numbered annotations |
| [ClaudeCockpit-Cheatsheet.html](ClaudeCockpit-Cheatsheet.html) | users | a printable single-page summary |
| [Tech.md](Tech.md) | developers | feature specification — FS · API · state transitions · invariant rules |

<!-- Contact form link (single replacement point) — to change it, edit just this one URL line and it applies to every "contact form" link in the README. -->
[form]: https://docs.google.com/forms/d/e/1FAIpQLSfdAAODOXSfYg8bQp-WLewENrP_otXglztMzfR7bL678wqdHg/viewform

<!-- Release link (single replacement point) — [zip] is a direct release-asset link (releases/download/vX.Y.Z/ClaudeCockpit-vX.Y.Z.zip).
     For each new release, update only the version in [zip] and the "currently vX.Y.Z" / filename (ClaudeCockpit-vX.Y.Z.zip) labels above.
     If the asset has not been uploaded yet, you can temporarily substitute the archive/refs/tags/vX.Y.Z.zip tag auto-archive.
     [releases] is the listing page — do not use /releases/latest, as it skips pre-releases. -->
[zip]: https://github.com/ReDocu/ClaudeCodeTemplate/releases/download/v0.3.0/ClaudeCockpit-v0.3.0.zip
[releases]: https://github.com/ReDocu/ClaudeCodeTemplate/releases
