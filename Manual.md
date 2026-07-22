
# ClaudeCockpit User Manual (For Beginners)

A local dashboard that lets you **view, start, and stop multiple Claude Code instances from a single screen.**
Instead of juggling several terminal windows and switching back and forth, you can see at a glance **which session of which project is currently working / waiting for your input**, and jump into that session only when you need to.

> ### Just remember these 3 terms
> - **Project** = a single body of work (e.g., my game, my website). One "card" on the screen is one project.
> - **Role / Session** = one terminal working inside a project. Distinguished by role name (e.g., `dev`, `art`).
> - **ops** = the **fixed session #1** that every project includes automatically. It's the home for operational tasks like git and deployment.

---

## 1. Prerequisites

| Item | How to check |
|---|---|
| Windows 11 | — |
| Node.js | Type `node -v` in the terminal → OK if a version appears |
| wmux (terminal tool) | Just needs to be installed. Its location is found automatically on first run |
| Claude Code | OK if it runs when you type `claude` in the terminal |

> There is **no program (npm package) to install.** You only need Node and wmux.

---

## 2. Getting Started — One Double-Click

**Double-click `ClaudeCockpit.exe`.** (If that's blocked, run `start.cmd` instead.)

It will then automatically:

1. **Start** wmux if it's off (if it's already on, it's used as-is)
2. **Launch the dashboard server** (the black console window is the server)
3. **Open the dashboard in your browser** → `http://127.0.0.1:7420/`

> - It's safe to click multiple times (if it's already running, it's simply reused).
> - **Closing the console window (the black window) does NOT kill your sessions.** Only the dashboard shuts down. Press the exe again to resume.
> - If it can't find the wmux location, the console will ask for the path. To reconfigure later: `node cockpit/bin/cockpit.js boot --setup`

---

## 3. How to Read the Screen

```
┌ Top bar ── ClaudeCockpit · in-progress/waiting counts · [Refresh][Link existing project][＋ git address][＋ New project]
├ Legend ──── Status is shown together in 3 ways: color, shape, and text
├ Left (main) ── ● In progress : currently open projects (session cards)
│               ⏸ Waiting     : projects created but not yet opened (collapsible)
│               ○ Unlinked    : sessions I opened directly in wmux (outside cockpit's control)
│               ▪ Stopped     : archived projects (collapsed · revive with [Resume])
└ Right (rail) ── 🔌 Active ports · 🧩 Feature list
Click a session row to open a detail drawer on the right.
```

### Top-right badge (current status)

| Badge | Meaning |
|---|---|
| `● live` | Server healthy (real data) |
| `▲ offline` | Server is down → **run the exe again** |
| `○ demo` | Opened the file directly (fake sample data) |

---

## 4. A Project's 3 States

| State | Meaning | What you can do |
|---|---|---|
| **⏸ Waiting** | Created but not open | Open with `[▶ Activate]` · store with `[Archive]` |
| **● In progress** | Currently open (running in wmux) | Open sessions · run Claude · deactivate |
| **▪ Stopped** | Archive | Revive to Waiting with `[Resume]` |

> **Activating (▶ Activate)** only *opens* the project — it **does not create sessions (terminals) automatically.** You open sessions one by one in the next step.

---

## 5. The 3 Steps to Open a Session ⭐ (Most Important)

Each role (ops, dev …) inside an in-progress card goes through the 3 steps below.

```
①  ○ Unlinked           →   Click [＋ Activate session]
②  Session opens (terminal) →   Briefly "Verifying connection…"
③  Connection verified   →   [↗ Open session] [Deactivate session] [▶ Run Claude]
```

1. **① Unlinked** — There's no terminal for that role yet. Click `[＋ Activate session]`.
2. **② Open** — One terminal (pane) is created in wmux.
3. **③ Ready** — Once the connection is verified, the `[▶ Run Claude]` button appears. Click it to start Claude in that terminal.

> - To open them all at once, click **`[＋ Activate all sessions]`** at the bottom of the card (it opens every missing session).
> - If the same role is already open, the existing one is used **instead of creating a new one** (no duplicates).

---

## 6. What Claude Is Doing Right Now — Activity Badges

Sessions where Claude is running get a **current-status badge**. You can judge what to do without even entering the session.

| Badge | Meaning | What you should do |
|---|---|---|
| `⏳ In progress` | Claude is **working** | Just leave it |
| `⌛ Waiting` | Finished responding and **waiting for your next instruction** | Enter a task |
| `⚠ Awaiting input` | **Waiting for approval / permission input** | Handle it first |
| `◆ fable-5[1m] · xhigh` | The **model · effort** this session uses (shown in place of the path · hover for the folder path) | For reference — to change it, use `/model` · `/effort` in that session |
| (no badge) `❯ terminal` | Claude isn't started yet | Use `[▶ Run Claude]` if needed |

> Don't see a badge? Either ① Claude isn't started in that session yet, ② you haven't entered the first prompt yet, or ③ (for a fresh install) the activity hook isn't installed yet.
> **Install the activity hook (one time only):** `node cockpit/bin/activity-hook.mjs install` in the terminal → to remove: `... uninstall`
> (This badge works via Claude Code's "hooks" feature. It's Claude reporting directly, not wmux.)

---

## 7. Basic Workflow (Start to Finish)

### ① Create a project
Top **`[＋ New project]`** → enter a name and roles (multiple, comma-separated: `dev, art`) → create.
- A `root/<name>/` folder is created and registered as **Waiting**. The `ops` role is included automatically.

### ② Open it
The card's **`[▶ Activate]`** → moves to In progress (no sessions yet).

### ③ Open sessions + run Claude
Each role's **`[＋ Activate session]`** → after the connection is verified, **`[▶ Run Claude]`** (see sections 5 and 6).

### ④ Observe (watch without entering)
**Click** a session row to open the drawer on the right:
- Claude status · activity badge · working folder (cwd) · the list of features this session uses (skill/MCP names only)
- **`[📁 Folder]`** — open the working folder in Explorer
- The card's **git chip (↗)** — open the remote repository's web page

### ⑤ Intervene (jump in only when needed)
The drawer's **`[Open ↗ (wmux jump)]`** → moves you to that terminal in wmux. Handle the approval/command yourself, then return to the dashboard.

### ⑥ Clean up
- **Stop a single session**: the drawer's **`[Deactivate session]`** (a confirmation dialog appears if Claude is working).
- **Stop the whole project**: the card's **`[Deactivate]`** → confirmation dialog (shows the list of sessions being stopped) → all sessions terminate + window closes → Waiting.
- **Archive**: the Waiting card's **`[Archive]`** → moves to the Stopped section. Later, `[Resume]`.

> ⚠️ **There is no undo.** Once you stop a session, that terminal's state is gone (you can reopen it, though). That's why a confirmation dialog appears before stopping.

---

## 8. 3 Ways to Add a Project

| Button | When | Result |
|---|---|---|
| **`[＋ New project]`** | Starting fresh | Creates an empty folder + default structure |
| **`[Link existing project]`** | When you want to manage a folder you already have | **Moves** that folder into `root/<name>/ops/` and registers it |
| **`[＋ git address]`** | Starting from a repository like GitHub | **Clones** the address into `ops/` and registers it as a new project |

> **git lives only in the `ops` folder.** The project root is not a repository — it's just a plain folder. (Code, commits, and remotes are all based in `ops/`)

---

## 9. Right-Side Info Panel

- **🔌 Active ports** — Detects running dev/DB servers (ports) and shows which project they belong to. System noise is collapsed and hidden.
  - **Turning OFF**: the **[✕]** on a row attributed to a project — after confirmation, it terminates that server process (the session pane is kept · only listeners originating from a project session are eligible).
  - **Turning ON**: on a project card, use **[＋ Server]** to declare a start command once (e.g., `npm run dev`) → after that, clicking **[▶ Start server]** enters the command into that role session's terminal on your behalf. If Claude is running in that pane, it's rejected (so the command doesn't go into the input box).
- **🧩 Feature list** — Shows only the **name · type** of features (skill · plugin · MCP) that all sessions use in common (config values · keys are never shown). Session-specific features are checked in that session's drawer.

> **There is no usage display.** It used to show today's/weekly token usage, but that was removed. Claude's actual limits are managed by the server across two windows — **5-hour and 7-day** — and summing only the records on my computer couldn't match that usage rate (there is no "daily" limit window at all). For the accurate usage rate, check with **`/usage`** in Claude Code.

---

## 10. Frequently Asked Questions (FAQ)

**Q. It says `▲ offline` / no data appears**
The server isn't running. Run `ClaudeCockpit.exe` again.

**Q. I click `[＋ Activate session]` but no session appears**
Usually it's because **wmux is off.** Run the exe (= boot) to start wmux. (The detailed cause appears on the server console's `[wmux✗] …` line — see the Q below to view it)

**Q. I want to see what's happening in the server console**
`ClaudeCockpit.exe` hides the console. To see the logs, run it directly in the terminal:
`node cockpit/bin/cockpit.js serve` → commands sent to wmux are printed as `[wmux→] …` / failures as `[wmux✗] …`.

**Q. It's an in-progress card, but all roles say "○ Unlinked"**
That's normal. Activating just opens the room; you open sessions one by one with `[＋ Activate session]` (section 5).

**Q. I don't see the `[▶ Run Claude]` button**
The session is still "Verifying connection," or Claude is already running. Wait a moment or check the badge.

**Q. The status doesn't change immediately**
The dashboard refreshes every few seconds and some information is cached. Wait a moment and it will update. If you're in a hurry, `[Refresh]`.

**Q. It says port 7420 is already in use**
Use a different port: `node cockpit/bin/cockpit.js serve --port 8080` (then connect to that address).

**Q. I fixed the code but the dashboard behaves like the old version**
The server is running the old code. Close the console window and run the exe again. (But if you only changed the screen design, a browser refresh is enough)

**Q. Does closing the dashboard kill my sessions?**
No. Even if you shut down the server/dashboard, the wmux sessions keep running. Press the exe again to resume monitoring.

---

## 11. Safeguards (Good to Know for Peace of Mind)

- **Local only** — The server is accessible only from this PC (127.0.0.1) and only with token authentication. Nothing gets in from outside.
- **Stopping is always by your own hand** — cockpit **never stops sessions on its own.** Stopping is only done two ways — `[Deactivate session]` (one) and `[Deactivate]` (all) — and both require confirmation.
- **No duplicates** — If it overlaps with an already-open session, it uses that one instead of creating a new one.
- **git is ops-only** — The project root is not a repository, so code doesn't get mixed in.
- **Secret protection** — `.env` values are neither read nor shown (only names · existence).

---

## 12. Learn More

| Document | Contents |
|---|---|
| `Tech.md` | **Functional specification** — details of all features · APIs · rules (for developers) |
| `handover.md` | Development progress (session-by-session records) |
| `CLAUDE.md` | Code map · edit points for developers/Claude |
| `README.md` | Project introduction |

---

### One-Page Summary

```
Double-click exe  →  [＋ New project]  →  [▶ Activate]  →  [＋ Activate session]  →  [▶ Run Claude]
                                                              │
                        Click a session row → drawer (observe) → jump via [Open ↗] (intervene)
                                                              │
                        End: [Deactivate session] (one) / [Deactivate] (all) / [Archive] (store)
   Badges:  ⏳ In progress = leave it   ⌛ Waiting = give an instruction   ⚠ Awaiting input = handle first
```
