# wmux Manual

> Source: https://wmux.org/docs
> Terminal multiplexer for Windows + AI agent integration desktop app

---

## 1. What is wmux?

wmux is a terminal multiplexer that runs as a **Windows desktop application**, with AI agent integration as its core feature. Within a single window, you can organize and operate multiple terminals simultaneously using vertical tabs and pane splits. In particular, it is designed to **run multiple Claude Code agents in parallel and monitor them in real time**.

### The problem it solves

It addresses the workflow fragmentation that arises when running multiple AI agents on Windows. Instead of managing scattered terminal windows, it unifies your workspace, centralizes notifications, and provides a built-in browser that visualizes agent activity.

---

## 2. Key Features

| Feature | Description |
|------|------|
| **Workspace organization** | Per-project containers. Displays git branch, directory, active ports, GitHub PR status, and notification badges |
| **Pane splitting** | Show multiple terminals at once with horizontal (Ctrl+D) and vertical (Ctrl+Shift+D) splits |
| **Surfaces (tabs)** | Multiple terminals per pane, with tab switching (Ctrl+Tab) |
| **Integrated browser** | Chromium-based. Displays agent activity via the chrome-devtools-mcp protocol |
| **Real-time sidebar** | Shows active workspaces and their metadata (git status, working directory, open ports, unread notifications) |
| **Claude Code integration** | Auto-detected and configured without manual setup. Monitors agent activity across sessions via hooks |

---

## 3. Installation

1. Download `wmux-X.Y.Z-win-x64.zip` from the GitHub releases
2. Extract it to a location of your choice (recommended: `C:\Users\[username]\wmux`)
3. Remove the "Mark of the Web" restriction:
   - Run `Get-ChildItem -Recurse | Unblock-File` in PowerShell, or
   - Uncheck the unblock checkbox in the file's properties before extracting
4. Run `wmux.exe` and approve the Windows SmartScreen warning

> No separate installer required — it is distributed as a portable archive. Automatic updates and notifications are supported.

---

## 4. Keyboard Shortcuts

| Shortcut | Action |
|--------|------|
| `Ctrl+T` | New tab in the current pane |
| `Ctrl+D` | Horizontal split |
| `Ctrl+Shift+D` | Vertical split |
| `Ctrl+W` | Close current tab |
| `Ctrl+Tab` | Next tab |
| `Ctrl+N` | New workspace |
| `Ctrl+1~9` | Switch workspace |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+Shift+B` | Toggle browser |
| `F11` | Full screen |
| `Ctrl+,` | Settings |

---

## 5. CLI Commands

```bash
wmux new-workspace --title "name" --cwd "path"   # Create a new workspace
wmux split --down                                 # Split the pane
wmux send "command"                               # Send a command
wmux list-workspaces                              # List workspaces
wmux browser open https://url                     # Open the browser
wmux notify "message"                             # Send a notification
wmux tree                                          # Display the structure tree
```

---

## 6. Core Concepts

- **Workspace** — A project-level container that holds terminals and content
- **Pane** — A visual block that displays a terminal, browser, or markdown
- **Surface** — A tab within a pane, holding an individual terminal
- **Sidebar** — The left-hand panel that displays the workspace list and real-time metadata

---

## 7. Configuration and Additional Features

- **Shell integration**: Automatic injection into PowerShell, Bash, and cmd.exe. Supports branch detection, dirty state, directory tracking, and port display
- **Environment variables**: `WMUX`, `WMUX_SURFACE_ID`, `WMUX_PIPE`, and `WMUX_CLI` are available in terminal sessions
- **Themes**: 450+ Ghostty presets plus Windows Terminal import (`wmux config import-wt`)
- **Session management**: Auto-saves every 30 seconds; manual save with `wmux session save "name"`
- **Notifications**: Visual (blue pane ring), sidebar badges, taskbar icon flashing, Windows toasts, and optional audio alerts
- **Named pipe**: Integrate with external tools via `\\.\pipe\wmux`

---

## 8. The wmux-orchestrator Plugin

A bundled plugin that coordinates multiple Claude Code agents for complex tasks. It analyzes your codebase, decomposes work into subtasks, and manages parallel execution in dedicated panes.

```bash
/wmux-orchestrator:orchestrate "task description"
```

---

## 9. License and Platform

- **License**: AGPL-3.0 open source
- **Platform**: Windows only (macOS/Linux not supported)
- **macOS counterpart**: cmux is the macOS equivalent

---

## 10. Common Issues & Solutions

| Issue | Solution |
|------|------|
| Module loading failure | Unblock the files after extracting |
| Shortcut conflicts | Check for interference from antivirus or productivity software |
| Claude Code not recognized | Verify the `WMUX` environment variable and the `~/.claude/CLAUDE.md` injection |
| Poor browser performance | Enable GPU acceleration in settings |
