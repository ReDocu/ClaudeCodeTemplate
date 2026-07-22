
# Tech.md — ClaudeCockpit Feature Specification

**Target**: ClaudeCockpit (rewrite v1) live-behavior deliverable — `cockpit/`
**Updated**: 2026-07-13 (as of session 13 — written from direct code measurement)
**Read alongside**: `CLAUDE.md` (code map · edit points · invariant rules) · `handover.md` (per-session progress) · `Manual.md` (usage)

This document specifies the features **currently built into** ClaudeCockpit, on a code basis. Each feature is described in terms of purpose, behavior, API, guards, and related files. Planned/unimplemented items live only in §17 (out of scope).

---

## 1. Overview

ClaudeCockpit is a local control tool for observing and controlling multiple Claude Code sessions from a browser dashboard **without entering the sessions**.

- **Three-tier mapping**: administrator (wmux user) ─ project (wmux **workspace**) ─ role (an **agent**/pane inside a workspace).
- **Assumed environment**: Windows 11 + wmux (0.13) + Node (built-in modules only) + git CLI. **Zero npm runtime dependencies.**
- **Boundary**: the server binds to `127.0.0.1` + uses `X-Cockpit-Token` exclusively, with **port 7420 as the canonical default** (reassignable via config). Remote exposure is a non-goal.
- **Boot chain**: `exe/boot` → ensure the multiplexer (fresh launch + clean slate for restored sessions if `ownsApp`) → ensure the server → reconverge active projects → default browser.

### 1.1 Live-behavior deliverables

| Deliverable | Role |
|---|---|
| `cockpit/dashboard.html` | Single-file dashboard (inline JS/CSS · zero dependencies) |
| `cockpit/bin/cockpit.js` | CLI — `serve` · `boot` |
| `cockpit/bin/activity-hook.mjs` | Claude Code hook runtime + global settings install/uninstall |
| `cockpit/src/*.js` | Bridge modules (§2.2) |
| `ClaudeCockpit.exe` · `start.cmd` | Cold-boot launcher (delegates to boot) |
| `root/<project>/project.json` | Project declaration (source of truth) |
| `cockpit/workspace/` | Runtime (config · logs · activity — **gitignored**) |

---

## 2. Architecture

### 2.1 Convergence of two states

```
root/<project>/project.json  (desired — the folder is truth)      wmux  (actual — measured workspaces·agents)
        └ lifecycle: activate=ensure workspace · spawn=per-role individual spawn · killSession=individual termination
                     deactivate=bulk kill+close · archive/reopen=declared-state transition. No commandless auto-termination.

browser dashboard ── fetch (same-origin · token) ─▶ server.js (sole HTTP layer · buildState)
```

Core principle: the **declaration (folder)** and the **measurement (wmux · processes)** are merged on every request before being exposed. The dashboard does not own state; it polls `GET /api/state`.

### 2.2 Module map

| Module | Responsibility |
|---|---|
| `server.js` | HTTP layer (sole) · `buildState` (declaration ⊕ measurement merge) · routes · token |
| `mux.js` | Single gateway to the multiplexer (façade) · per-platform driver selection (darwin=cmux · otherwise=wmux) · state cache (`getState`/`getFresh`/`invalidate`) · normalization · `isDead` filter · spawn-argument contract · shell resolution. **Callers above only import this file — the platform branch ends here** |
| `mux/wmux.js`<br>`mux/cmux.js` | Drivers (identical contract) — app discovery·launch (`ensureApp`) · protocol round-trip (direct pipe / cmux CLI) · control verbs · app termination (`killApp`) · **command console logging**. `OWNS_APP` (wmux=true · cmux=false) governs both boot's clean slate and the app termination on full shutdown |
| `registry.js` | Project declaration scan·create·link · isolation scaffold · ops git scaffold · role folders · config read/write |
| `lifecycle.js` | Lifecycle transitions · ensure workspace · individual spawn/kill · adoption-decision basis |
| `proc.js` | Live measurement of the claude on/off process tree (non-blocking cache) |
| `activity.js` | Reads session-activity (working/waiting/attention) state files |
| `follow.js` | workspace git follow (FS-21) — **the cockpit's only background loop** (2s) · detects active-workspace change → derives the repo (`repoDirOf`) → moves the embedded browser panel · config toggle |
| `bin/activity-hook.mjs` | Claude Code hook runtime · merge install/uninstall into global `~/.claude/settings.json` |
| `ports.js` | Active port map (live listener measurement · project attribution · noise filter) |
| `caps.js` | Capability inventory (global/session skill · agent · MCP — name and kind only) |
| `git.js` | git chips (branch · remote · web link) · remote clone/connect · URL→name derivation |
| `log.js` | Central event log (JSONL) record/query |
| `bin/cockpit.js` | CLI — `serve` (server) · `boot` (cold boot) |

### 2.3 Data contract — `GET /api/state`

```
{ projects[], unlinked[], ports[], hookInstalled, mux }
```

- **`projects[]`** = `{ name, status('active'|'idle'|'archived'), createdAt, archivedAt, links[], roles[{id}], wsLive, git{branch,remote,web}, sessions[] }`
- **`sessions[]`** = `{ role, agentId, connected, adopted, claude('on'|'off'|'unknown'), activity('working'|'waiting'|'attention'|null) }`
  - `connected` = matches a declared role label or is adopted · `activity` is filled **only when claude is on**
- **`unlinked[]`** = `{ wsId, title, sessions[{role, agentId, claude}] }` — multiplexer workspaces not matched to a project (external sessions opened directly)
- **`ports[]`** = `{ p(':port'), proc, project|null }`
- **`mux`** = `{ name('wmux'|'cmux'), ownsApp, canOpenWeb, follow }` — the dashboard does not know the platform, so the server tells it. If `ownsApp=false` (cmux — the user's everyday terminal), [⏻ Shut down] does not bring the app down and the confirmation text changes to "only the server goes down" · if `canOpenWeb=false`, git chips fall back to the default browser instead of the embedded panel and the [↺ git follow] chip is hidden · `follow` = whether workspace git follow (FS-21) is on

Lifecycle state = project `status` (declaration) · session liveness = `claude` process measurement · session activity = hook measurement.

---

## 3. Feature Specification (FS)

### FS-1 · Boot & server startup

| Item | Detail |
|---|---|
| Purpose | A single double-click of the exe brings up wmux, the server, and the dashboard with zero input |
| Commands | `cockpit.js serve [--port]` (server only) · `cockpit.js boot [--port] [--setup]` (cold boot) |
| boot stages | ① ensure the multiplexer is discovered·launched (`mux.ensureApp` — driver's responsibility) → ①-b **clean slate** (only when boot launched the app itself and `mux.ownsApp` — clears all auto-restored prior sessions·workspaces and rebuilds from the declaration. An already-running app is untouched; cmux is always excluded since `ownsApp=false`) → ② ensure the server (reuse an existing listener, idempotent) → ③ **auto-reconverge active projects** → ④ open the default browser |
| Port priority | `--port` > `config.port` > **7420** (canonical) |
| Server policy | binds `127.0.0.1` · every path except `GET /` requires `X-Cockpit-Token` · body cap 1MB (413) |
| Token injection | when `GET /` serves `dashboard.html`, a token meta is injected into `<head>` → authenticates same-origin fetch |
| Related | `bin/cockpit.js`, `server.js` |

### FS-2 · Project declaration & scan

| Item | Detail |
|---|---|
| Declaration file | `root/<project>/project.json` (**incompatible** with the old `team.json` — no migration) |
| Scan | `root/` at depth 1 · only folders containing `project.json` are projects · dot (`.`) folders excluded |
| Lenient parsing | missing/misspelled status → `idle` · missing createdAt → folder creation time · broken JSON is flagged as a scan error and the scan continues |
| Path truth | project paths and role cwds derive **only from the declaration folder** (`p._dir`, `ensureRoleDir`) — never rely on wmux cwd drift |
| Related | `registry.js` (`scanProjects` · `findProject`) |

### FS-3 · State query (`GET /api/state`)

| Item | Detail |
|---|---|
| Behavior | declaration scan ⊕ wmux measurement merge → §2.3 payload. The dashboard polling entry point |
| session→role resolution | adoption mapping (`adopted[agentId]`) takes precedence, else label · a declared role gets `connected:true` |
| Session ordering | ops first → declared-role order → orphans last |
| Non-blocking | all on-demand probes (git · proc · activity · ports · caps) are non-blocking — they never hold up the response |
| Related | `server.js` (`buildState`) |

### FS-4 · Lifecycle — activate / deactivate / archive / reopen

| Transition | API | Behavior |
|---|---|---|
| idle→active | `POST /activate {name}` | **only ensures the workspace · no session spawn** (initially unconnected). 409 if archived |
| active→idle | `POST /deactivate {name, confirm:true}` | **① stop the attributed active port listeners (dev servers)** (before killing sessions — parent-tree attribution requires the session pids to still be alive; failure is non-blocking) → **② kill every live session in the ws including ops → close the workspace → idle**. 400 if `confirm` is missing |
| idle→archived | `POST /archive {name}` | archive (folder·declaration preserved). 409 if active (deactivate first) |
| archived→idle | `POST /reopen {name}` | reopen — return to standby (no immediate activation) |
| Principle | — | **No commandless auto-termination.** kill happens only via the two explicit paths below (§FS-5) |
| Related | — | `lifecycle.js` |

### FS-5 · Session management — individual spawn & termination (3 stages)

Sessions are not created automatically on activation; each role is opened individually.

| Stage | UI | API | Behavior |
|---|---|---|---|
| ① initially unconnected | `○ Unconnected` row + `[＋ Activate session]` | — | a declared role with no measured session |
| ② open session | `[＋ Activate session]` | `POST /spawn {name, role?}` | 3 stages: **① move wmux focus to that workspace** (`workspace.select` · best-effort, response `focused`) → **② spawn the role pane right there** (if role is omitted, spawn all missing ones · uses `getFresh` each time to prevent duplicates, reusing any duplicate) → **③ verify connection** (confirm against the target workspace measurement, up to ~3s — auto-bind by adoption if no label is attached · misplaced panes are cleaned up · a verification failure is reported as `failed`, and the dashboard keeps the [＋ Activate session] button) |
| ③ after connection confirmed | `[↗ Open session] [Deactivate session] [▶ Run Claude]` | — | once the claude probe resolves (off), the run button is shown |
| individual termination | `[Deactivate session]` (drawer) | `POST /kill-session {name, agentId}` | kill one session. If claude is running, the dashboard shows a confirmation dialog |
| ops pin | `📌 ops pin` | — | ops = the project's session #1 (the home for git/DB/deploy checks) |
| Related | — | `lifecycle.js` (`spawnRole` · `killSession` · `ensureWorkspace`) |

**There are only two kill paths**: individual `killSession` + bulk `deactivate` (confirmation gate). No other auto-termination.

### FS-6 · Running Claude & on/off measurement

| Item | Detail |
|---|---|
| Run | `POST /claude {agentId}` → sends `claude\n` to that pane's surface. If already running, the resend is skipped (`already`) |
| Send rule | **surfaceId must be specified** (focus-based sending misfires) |
| on/off measurement | wmux does not know a pane's inner process → **walk down the process tree** from the agent shell pid to find a claude CLI (native/npm) descendant |
| Three-valued state | `on` (measurement true) · `off` (measurement false) · `unknown` (cold snapshot · non-Windows — run button not shown) |
| Cache | one PowerShell CIM query → TTL 4s + single-flight + non-blocking |
| Related | `proc.js`, `server.js` (`POST /claude`) |

### FS-7 · Session activity badge (working/waiting/attention) ⊕ model·effort chip

| Item | Detail |
|---|---|
| Purpose | show "command running / waiting / awaiting input" and **the model·effort the session is using** — model·effort appears in the **session-row path slot (.now)** (if measured, shown in place of `root/<proj>/<role>/` and the path moves into the title · if not measured, the path stays) and as a pill in the drawer |
| Principle | wmux does not know a pane's inner state, so this is obtained via **Claude Code hooks** — all measured from local files (zero token consumption) |
| Hook mapping | `UserPromptSubmit`→**working** · `Stop`→**waiting** · `Notification`→**attention** |
| Recording | the hook runtime records to `cockpit/workspace/activity/<proj>__<role>.json` only when cwd is under `root/<proj>/<role>/` (otherwise the session exits immediately) · always exit 0 (never blocks the session) |
| model·effort | effort = the official common field `effort.level` from the hook stdin (absent if the model doesn't support effort) · model = the latest assistant `message.model` from the tail (last 256KB) of the `transcript_path` the hook received — the sole exception to §13 "transcript parsing removed". If this observation is null, the previous value is retained (prevents chip flicker) |
| Read | `getActivity(proj,role)` → `{state, model, effort}`. In state, working goes stale→null after 10 minutes (crash defense) · model/effort are non-perishable values, so they persist even when stale |
| Exposure | buildState attaches the `activity`·`model`·`effort` fields **only when claude is on** (ignores leftover files of a turned-off session) |
| Badges | `⏳ Running` (accent) · `⌛ Waiting` (faint) · `⚠ Awaiting input` (warn) · `◆ model·effort` (violet · mono — session row shows path-slot text · drawer shows a pill, abbreviated notation · original text and cwd in the title) |
| Install | `activity-hook.mjs install|uninstall` — merges into global `~/.claude/settings.json` (backup · idempotent · preserves existing wmux hooks) |
| Install guidance | when measured as not installed (`hookInstalled()` — no entry in settings.json), the dashboard shows a banner: the manual install command + a one-click **[🪝 Install hook]** (`POST /hook-install` — runs install as a child process) · [Hide] = localStorage `ck-hook-hide` · effective only from newly started Claude sessions |
| Related | `bin/activity-hook.mjs`, `src/activity.js` (`getActivity` · `hookInstalled`), `server.js` (buildState · `POST /hook-install`), `dashboard.html` (`hook-banner`) |

### FS-8 · Unconnected sessions & adoption (adopt)

| Item | Detail |
|---|---|
| Unconnected (orphan) | a live pane not matched to a declared role (wmux's auto first pane, etc.) — labeled `○ Unconnected` |
| Adopt | `POST /adopt {name, agentId, role}` → saves `adopted{agentId→role}` into project.json |
| Guards | 400 if no agentId · 400 for an undeclared role · 404 unless the session belongs to the project workspace · 409 if the role is already filled |
| Effect | an unoccupied open session of the same role is **reused** instead of spawned |
| Related | `server.js` (`POST /adopt`), `buildState` |

### FS-9 · Project creation & linking

| Path | API | Behavior |
|---|---|---|
| New project | `POST /create {name, roles[]}` | create the `root/<name>/` isolation scaffold → standby. Re-calling merges roles (idempotent) · 409 if the folder exists |
| Link existing folder | `POST /import {path, name?}` | **move (rename)** an external folder to `root/<name>/ops/` · if the path is already under `root/`, **register in place** (re-registering an old team) |
| Pick folder | `POST /pick-folder {title?}` | the server opens a **native folder picker** (Windows FolderBrowserDialog) and returns the selected absolute path (`{path}`). The dashboard's `📁 Browse` uses this instead of typing a path — read-only; the actual move is done by `/import` |
| Create from git URL | `POST /create-git {url, name?}` | create the scaffold ⊕ synthesize a clone into ops. If no name is given, derive it from the URL (400 if it can't be derived) |
| Name validation | — | strips filesystem-forbidden characters · 400 for empty / dot-leading names |
| Move safety | — | same-volume only · on failure the original is unchanged (backup restore) |
| Related | — | `registry.js` (`createProject` · `importProject`), `git.js` |

### FS-10 · Add / remove role

| Action | API | Rules |
|---|---|---|
| Add | `POST /create {name, roles}` merge | add the role to the declaration + ensure the role folder (not a free spawn — spawning is `/spawn`) |
| Remove | `POST /roles {name, role, action:'remove'}` | remove from the declaration only, **preserving the folder**. 400 for ops · 409 if a session is alive |
| Related | — | `registry.js` (`removeRole`), `server.js` |

### FS-11 · git integration (single ops repository)

| Item | Detail |
|---|---|
| **Invariant** | the git repository lives **only in `ops/`**. The project root is not a repository (no nested repositories) |
| Scaffold | for an empty project, `scaffoldOpsGit` does `git init` on ops + a secrets `.gitignore`. For a remote project, ops is cloned |
| Remote connect | `POST /git-remote {name, url}` → clone into ops. **If ops is a skeleton, replace with the clone; if it's a repository with real content, only update the remote (preserving local work)** |
| git chip | `getGit(ops)` → branch · remote URL · web link (ssh/git→https normalization). Non-blocking cache (TTL 30s) |
| Related | `git.js`, `registry.js` (`scaffoldOpsGit`) |

### FS-12 · Isolation scaffold (D16)

| File | Purpose |
|---|---|
| Project CLAUDE.md | declares invalidation of the parent cockpit policy (ancestor loading can't be blocked → the sole line of defense) · names ops for git |
| ops `git init` + `.gitignore` | ops = the sole repository · pre-blocks secrets (deploy-keys · connections.json · .env.* · logs) |
| Per-role CLAUDE.md skeleton | injected **only into a freshly created empty role folder** (not into cloned ops · not into imported code — contamination prevention) |
| Idempotent | never overwrites an existing file |
| Related | `registry.js` (`scaffoldIsolation` · `ensureRoleDir`) |

### FS-13 · Service links

| Item | Detail |
|---|---|
| Purpose | register external links (deploy · DB console, etc.) as chips on the project card |
| API | `POST /links {name, action:'add'|'remove', url, label?}` — **http(s) only** (400 otherwise) |
| Open | opens in a new default-browser tab from the dashboard |
| Related | `server.js` (`POST /links`) |

### FS-14 · Active port map ⊕ server ON/OFF

| Item | Detail |
|---|---|
| Purpose | measure dev/db listeners → show project attribution (right rail) · **stop attributed listeners (OFF) · start via declared command (ON)** |
| Attribution | match an active project's session pids ↔ the listener's owner process |
| Filter | separate out system/noise listeners (collapsible) |
| Exposure | `ports[]` in `GET /api/state` (**includes port·pid**) · the project's `serve` declaration (`{role, cmd}` — project.json) |
| OFF | the rail's attributed-row **[✕]** → `POST /port-kill` — requires kill-path confirmation (§9-3) + optimistic re-validation (⑤: on a forced rescan, exact (port,pid) match + **re-confirm project attribution** — prevents mistakenly killing system·wmux) → `taskkill /T` process-tree termination (the pane shell is the listener's parent, so it survives — the session is kept) |
| Bulk OFF | **deactivate·full-shutdown also stop attributed listeners** — `deactivate` forces a fresh measurement (`freshProjectListeners` — same logic down to the attribution decision) **before** killing sessions, then tree-terminates. The confirmation dialog lists the target ports in advance, failure is non-blocking (log only). Response carries `portsKilled` |
| ON | the cockpit does not know the start command → declare it via the card's **[＋ Server]** (`POST /serve` — clear it by emptying and confirming) → **[▶ Start server]** `POST /serve-start` does a sendLine to the role pane shell (isomorphic to `POST /claude`). **409 if the pane has claude on/unknown** (prevents the command from being contaminated into claude's input box) |
| Related | `ports.js` (`freshListener` · `killPid`), `server.js` (`projPortInfo`), `dashboard.html` (`portKillPrompt` · `servePrompt`) |

### FS-15 · Capability inventory (caps)

| Item | Detail |
|---|---|
| Purpose | show the skill · agent · MCP a session has inherited/holds by **name and kind only** (values·keys not exposed) |
| Scope | global (`~/.claude` — right rail) · project/session (role folder `.claude/` · `.mcp.json` — drawer) |
| API | `GET /api/caps` (global) · `GET /api/caps?project=&role=` (session scope) |
| Related | `caps.js` |

### FS-16 · Usage — **removed**

Usage/limits used to be shown by summing local transcripts, but this was removed. Reason: Claude's real limits are managed by the server over **two windows, 5-hour and 7-day**, and that utilization cannot be reproduced from transcripts — a rolling 7 days ≠ a fixed reset window, cache reads and per-model weights are unknown, and usage on other machines is absent. The denominator was a learned estimate rather than an official limit, so it was structurally inconsistent with `/usage`.

To use server-measured values, the only official path is the statusline stdin's `rate_limits.five_hour` / `rate_limits.seven_day` (`used_percentage` · `resets_at`) — but only **percentages** are provided (no absolute tokens or limit values) and they exist only after the session's first API response. A "daily" window does not exist in Claude's limit structure.

### FS-17 · Central event log

| Item | Detail |
|---|---|
| Purpose | records state transitions · spawn/kill · create/link · claude · git · errors to a central JSONL |
| Storage | `cockpit/workspace/logs/events.jsonl` (gitignored) |
| Query | `GET /api/log?project=&limit=` — dashboard log view · recent events on the project card |
| Levels | `info` · `error` |
| Related | `log.js` |

### FS-18 · Session detail drawer

| Item | Detail |
|---|---|
| Entry | click a session row |
| Display | claude state · **activity badge** · ops-pin/unconnected tags · cwd · agentId · capability inventory (global/project/session scope) · scope notes |
| Actions | `[Open ↗ (wmux jump)]` · `[📁 Folder]` · `[▶ Run Claude]` (when off) · `[⎇ Sync to role]` (orphan) · `[Deactivate session]` |
| Related | `dashboard.html` (`openSession`) |

### FS-19 · wmux command console logging

| Item | Detail |
|---|---|
| Purpose | print the commands·descriptions·success/failure sent to wmux to the server console — for diagnostics. Dashboard toasts are also mirrored via `POST /console` |
| Format | everything goes through `log.js`'s `logConsole` → unified with the **`[error]content : …`** prefix. Examples: `[error]content : <t> [wmux→] <method> <description>` · `[wmux✓] <method> → <id>` · `[wmux✗] <method> — <error>` (the wmux markers are preserved in the content) |
| Noise suppression | high-frequency polls (`workspace.list` · `agent.list`) exclude success logs (failures always logged — for offline diagnostics) |
| Toggle | `COCKPIT_WMUX_LOG=0` turns off wmux logs only (the toast mirror is separate) · **a detached server hides stdout** → to see the console, run `serve` from a terminal |
| Related | `mux/wmux.js` (`request` · `CMD_DESC`) · `mux/cmux.js` (`cli` — same rules, `[cmux→]`/`[cmux✓]`/`[cmux✗]`), `log.js` (`logConsole`), `server.js` (`POST /console`), `dashboard.html` (`ping` · `mirrorToConsole`) |

### FS-20 · Open folder & wmux jump & embedded browser

| Action | API | Detail |
|---|---|---|
| Open Explorer | `POST /open {name, role?}` | open the project/role folder in Explorer. Paths outside `root/` are 400 (guard) |
| wmux jump | `POST /attach {agentId}` | select that workspace + focus the pane (move to the pane the user is looking at) |
| Open embedded browser | `POST /open-web {url}` | git chip → show the remote repository page in the **multiplexer's embedded browser panel**. http(s) only (400 `http-only`) · unsupported multiplexers return 501 `open-web-unsupported` |
| Related | — | `server.js` · `mux.js` (`openWeb` · `canOpenWeb`) · `mux/wmux.js` (pipe `browser.navigate {url}` — **measured 2026-07-16**: among `browser.*`, the only one the pipe knows is navigate) |

> **cmux unsupported (opt-in contract)** — a browser surface really does exist in cmux too (the one `fetchState` filters out with `type!=='terminal'`), but the CLI/RPC contract to open it is undocumented·unmeasured, so `openWeb` is not exported. The façade decides `canOpenWeb=false` → the dashboard falls back to a new default-browser tab (graceful degradation). Once measured on darwin and added to `mux/cmux.js`, it turns on with no change to upstream code (FS-21 follow turns on together with it).

### FS-21 · workspace git follow

| Item | Detail |
|---|---|
| Purpose | when the active workspace changes, automatically show **that workspace's repository page** in the multiplexer's embedded browser panel |
| Mechanism | `follow.js` — **the cockpit's only background loop** (2s). wmux does not push events and the server is request-based, so to catch the user switching directly in wmux (`Ctrl+1~9`) the only option is polling. It shares `getState()`'s TTL cache (1.5s) with the dashboard polling, so no additional pipe load is added |
| Toggle | dashboard [↺ git follow ●] chip · `POST /follow {enabled}` → `config.followWorkspaceGit` (on by default, no server restart needed) |
| Repo derivation | `workspace.cwd` → `repoDirOf()`. **wmux's cwd moves with the active pane (measured 2026-07-16)** — the same workspace shows up as both `root/<proj>` and `root/<proj>/ops`, and if the user `cd`s it goes deeper → walk upward to find the repository |
| **Leak defense** | ① for the project root, look at `ops/` **first** (isolation rule: the root is not a repository) ② when inside `root/`, **never** climb above `root/<project>/` — `root/`'s ancestor is the cockpit repository (`ClaudeCodeTemplate/.git`), so climbing blindly would **mistakenly show the cockpit's own GitHub page** |
| Safety rules | ① move only once per change (re-moving every tick = the panel reloads every 2 seconds) ② if the remote can't be obtained, leave the panel unchanged ③ swallow failures (an add-on feature must not block the server) ④ offline·reconnect (epoch change) only sets the baseline and does not move ⑤ **ignore cockpit's self-induced switches** — spawn focus moves·attach jumps·ws creation only refresh the baseline via `noteSelect()` (track user switches only) ⑥ **stabilization debounce** — move only when a new active ws is observed for 2 consecutive ticks (≈4s) (ignore fleeting switches — measured: 1–2s chained moves repeatedly cover the panel) ⑦ **skip re-moving to the same repository** (remembers the last URL — preserves scroll·login) · a local-only (no-remote) repository is not retried |
| Related | `follow.js` (`tick` · `repoDirOf` · `startFollow` · `noteSelect`), `mux.js` (`normWs`'s `isActive` · `cwd` — the only basis for follow), `lifecycle.js` (`spawnRole` · `ensureWorkspace` call `noteSelect`), `server.js` (`POST /follow` · `/attach` · `serve()` starts the loop), `dashboard.html` (`renderFollow` · `toggleFollow`) |

---

## 4. API endpoint reference

Every path except `GET /` requires `X-Cockpit-Token` (401 if absent).

### GET

| Path | Returns | Notes |
|---|---|---|
| `/` | dashboard HTML | token injected |
| `/api/state` | `{projects, unlinked, ports, hookInstalled}` | polling entry point · if `hookInstalled=false`, the dashboard shows the hook-install guidance banner (FS-7) |
| `/api/log?project=&limit=` | `{events}` | limit max 100 |
| `/api/caps?project=&role=` | `{global}` or session caps | global if no project |

### POST (body = JSON)

| Path | body | Success | Key guards |
|---|---|---|---|
| `/activate` | `{name}` | `{wsId, spawned:0}` | 503 wmux-offline · 409 archived |
| `/spawn` | `{name, role?}` | `{wsId, spawned, reused, failed, focused}` | 400 unknown-role · 503 |
| `/kill-session` | `{name, agentId}` | `{killed, role}` | 404 session-not-found · 409 project-inactive |
| `/deactivate` | `{name, confirm:true}` | `{killed, portsKilled}` | **400 confirm-required** — stop attributed listeners → full kill (FS-14 bulk OFF) |
| `/archive` | `{name}` | `{ok}` | 409 project-active |
| `/reopen` | `{name}` | `{ok}` | — |
| `/create` | `{name, roles[]}` | `{created, added}` | 409 folder-exists · 400 invalid-name |
| `/import` | `{path, name?}` | `{name, inPlace, backup}` | 400 path / move failure |
| `/pick-folder` | `{title?}` | `{path}` (cancel=`null` · non-Win=`unsupported`) | — (native picker) |
| `/console` | `{msg}` | `{ok}` | — (mirrors a dashboard toast to the server console as `[error]content : …`) |
| `/hook-install` | — | `{ok}` | 500 hook-install-failed (activity-badge hook install — FS-7 banner [🪝 Install hook]) |
| `/create-git` | `{url, name?}` | `{name, action, git}` | 400 git-url-invalid · name-underivable |
| `/roles` | `{name, role, action:'remove'}` | `{removed}` | 400 ops-fixed · 409 role-alive |
| `/claude` | `{agentId}` | `{ok, already?}` | 502 no-surface |
| `/attach` | `{agentId}` | `{ok}` | 404 agent |
| `/open` | `{name, role?}` | `{ok}` | 400 bad-path |
| `/open-web` | `{url}` | `{ok}` | 400 http-only · 501 open-web-unsupported · 502 open-web-failed |
| `/follow` | `{enabled}` | `{follow}` | 400 enabled-required · 501 open-web-unsupported |
| `/adopt` | `{name, agentId, role}` | `{agentId, role}` | 409 role-filled · 404 · 400 |
| `/git-remote` | `{name, url}` | `{action, backup, git}` | 400 git-url-invalid |
| `/links` | `{name, action, url, label?}` | `{links}` | 400 http-only |
| `/port-kill` | `{port, pid, confirm:true}` | `{ok}` | **400 confirm-required** · 409 listener-gone · not-project-listener · 502 kill-failed (FS-14 OFF) |
| `/serve` | `{name, action:'set'\|'clear', role?, cmd?}` | `{serve}` | 400 cmd-required · cmd-too-long · unknown-role · unknown-action (FS-14 ON declaration) |
| `/serve-start` | `{name}` | `{ok}` | 400 no-serve-config · 409 project-inactive · role-session-missing · pane-claude-on · pane-state-unknown · 502 no-surface · 503 wmux-offline (FS-14 ON) |
| `/shutdown` | `{confirm:true}` | `{deactivated, failed, portsKilled}` | **400 confirm-required** — deactivate all projects (including stopping attributed servers) → flush the response → **terminate the app (only when `mux.ownsApp` — wmux is taskkilled · cmux is the everyday terminal, so it is kept)** → shut down the server. Normally the app lifetime is not owned; only ⏻ Full shutdown is the exception |

Common errors: 401 (token) · 413 (body>1MB) · 400 bad-json · 404 unknown-project · 503 wmux-offline.

---

## 5. UI composition

```
┌ Top bar: logo · ministat (running/waiting/terminated · source badge) · [Refresh][Link existing project][＋ git URL][＋ New project]
├ Legend: state = triple-encoded by color + shape + text
├ Left main column
│   ● Running    — tcard (3-stage session rows · activity badge · conn chip · recent events · [＋ Activate all sessions][＋ Role][Deactivate])
│   ⏸ Waiting    — collapsible · role chips · [▶ Activate][＋ Role][Archive]
│   ○ Unconnected — external wmux workspaces (collapsed by default)
│   ▪ Terminated — archived (collapsed) · [Reopen]
└ Right rail: 🔌 Active ports (attribution shown) · 🧩 Capability inventory (global)
Drawer: session detail (FS-18) · Dialog: shared confirm/namer/logbox skeleton · Toast · SR live region
```

- **Source badge**: `● live` (server healthy) · `▲ offline` (server dead) · `○ demo` (file:// fallback).
- Opening the dashboard directly via `file://` falls back to built-in demo data (verify the UX without a server).

---

## 6. State transitions

```
                 POST /activate (ensure ws, no spawn)
        idle  ───────────────────────────────────▶  active
          ▲                                            │
          │   POST /deactivate (confirm · full kill+close)
          └────────────────────────────────────────────┘
        idle  ──POST /archive──▶ archived ──POST /reopen──▶ idle

    inside active (sessions): POST /spawn (add per role) · POST /kill-session (individual termination)
```

- Activation **does not spawn sessions** (initially unconnected) — sessions are spawned individually.
- archive returns 409 if active (deactivate first — kill is not hidden inside archive).

---

## 7. Invariant rules (confirmed by measurement — break them and the bug recurs)

1. **wmux cache contract**: reads·polling = `getState()` (stale allowed) · mutation decisions (whether to spawn) = `getFresh()` (real round-trip) · after a mutation, `invalidate()`. Deciding to spawn from stale data creates duplicates.
2. **agent measured fields**: `agentId` · `label` · `cmd` · `status` · `paneId` · `surfaceId` · `pid` · `workspaceId`. kill does not remove it from the list → `getState()` applies the central `isDead` filter.
3. **Session sending requires an explicit surfaceId** — focus-based misfires. Passing a paneId to send_text yields "no PTY".
4. **Path truth = the folder** — always specify `--cwd` on spawn (blocks home drift).
5. **git = single ops repository** — the root is not a repository. `connectRemote` clones if ops is a skeleton, updates the remote if it's a real repository.
6. **kill has only two explicit paths** — `killSession` (individual) + `deactivate` (full · confirm gate — includes cleaning up attributed listeners). No commandless auto-termination.
7. **Individual session spawn** — activate does not spawn. The spawn decision uses `getFresh` each time (duplicate prevention).
8. **Session activity = Claude hook measurement (not wmux)** — cwd guard · exposed only when claude is on · working 10-minute stale defense.
9. **Adoption (adopt)** — `connected = adopted[agentId] || declaredRoles.has(label)`. An unoccupied open session of the same role is reused.
10. **Non-blocking probes** — none of ports/proc/caps/git/activity ever block `/api/state`.
11. **Isolation scaffold** — no cockpit files are injected into cloned ops·imported code. Existing files are not overwritten.
12. **cmd batch files are ASCII-only** (CP949 parsing) — Korean messages live in the JS/C# layer.
13. **`.env` values are not stored·not shown** — only key names·existence.

---

## 8. Security · policy

- The server is `127.0.0.1`-only · a token (`config.token`, gitignored) is required · remote exposure is a non-goal.
- Secrets: `.env` · deploy-keys · connections.json are pre-blocked by the isolation `.gitignore`, and values are never stored/shown.
- `POST /open` returns 400 for paths outside `root/` (path-escape prevention).
- Links are http(s) only.

---

## 9. Runtime files (gitignored — absent in a fresh clone)

| File | Content |
|---|---|
| `cockpit/workspace/config.json` | port · token · wmuxBin · shell (auto-generated by the server) |
| `cockpit/workspace/logs/events.jsonl` | central event log |
| `cockpit/workspace/activity/<proj>__<role>.json` | session activity state (hook-recorded) |
| `root/<project>/` runtime | code and role folders besides project.json (the parent repository ignores `root/*`) |

---

## 10. Verification conventions (no test framework)

1. `node --check <file>` — for every JS you edit. For the dashboard, extract `<script>` first, then check.
2. **Live probes** — verify against real wmux/HTTP/modules with one-off `.mjs` files in the scratchpad (not committed). Probes must always clean up (kill spawned agents · delete `root/_Tmp*` · kill leftover pwsh · restore config).
3. wmux/cmux are not on the shell PATH — import `src/mux.js` in the probe (the platform-appropriate driver attaches). `wmux browser` is for the user's interactive shell (`!`) only.
4. **A server restart is required after code edits** (for HTML-only edits, refresh the browser — `readFileSync` on every request).

---

## 11. Out of scope (v1 non-goals)

- Remote exposure·auth-layer expansion · DB/deploy **manipulation** (currently display·link only) · transcript parsing (only the hook's model detection is the exception) · git diff·activity-feed view · **usage·limit display** (FS-16 — removed) · cross-volume moves (same-volume only).
