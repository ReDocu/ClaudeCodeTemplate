> **Language:** [한국어](cmux_manual.md) · **English**
# cmux Manual

> Source: https://cmux.com/
> Native terminal for macOS — built for multitasking, organization, and programmability

---

## 1. What is cmux?

cmux is "a terminal built for multitasking, organization, and programmability." It is a **free, open-source native macOS terminal** application built on top of **Ghostty's rendering engine (libghostty)**, designed for developers who manage multiple terminal-based AI agents and coding workflows.

### The problem it solves

It addresses the difficulty of orchestrating many concurrent terminal processes, especially AI coding agents. It replaces hidden background processes with **visible, controllable panes** and provides real-time notifications when an agent needs attention.

---

## 2. Key Features

- **Vertical tabs** — Display git branch, working directory, ports, and notifications in the sidebar
- **Notification rings** — Visual alerts when a pane needs attention
- **Split panes** — Horizontal and vertical splits within a tab
- **Built-in browser** — A scriptable browser pane controlled via API (for testing)
- **Programmability** — CLI and Unix socket API for automation
- **GPU acceleration** — Native Swift + AppKit rendering (not Electron)
- **Lightweight** — Native macOS implementation
- **Open source** — Published on GitHub under the GPL license
- **Keyboard shortcuts** — Extensive, customizable shortcuts
- **iOS companion** — Real-time terminal sync to iPhone/iPad (beta, TestFlight)
- **Session persistence** — Restores windows, workspaces, panes, and scrollback on relaunch

---

## 3. Supported Agents

Works with any terminal-based coding agent that can run from the command line:

> Claude Code, Codex, OpenCode, Gemini CLI, Kiro, Aider, Goose, Amp, Cline, Cursor Agent, and more

---

## 4. Multi-Agent Orchestration

Supports Claude Code teams and oh-my-opencode multi-model orchestration, displaying every agent as a **native pane** rather than a hidden process.

---

## 5. Remote Features

- **SSH workspace** support
- **Remote tmux session attach** support
- Run agents on remote hosts while controlling them locally

---

## 6. Browser Automation

cmux can split a real browser pane next to your terminal, and through the same socket API it supports:

- Programmatic navigation
- DOM snapshots
- JavaScript execution
- Console and network monitoring

---

## 7. Skill System

Provides reusable workflows through the **cmux-skills** repository:

- CLI control
- Workspace automation
- Configuration
- Browser manipulation

---

## 8. Customization and Configuration

| Item | Location / Method |
|------|-------------|
| Terminal settings | Read from Ghostty settings (`~/.config/ghostty/config`) |
| cmux settings | `~/.config/cmux/cmux.json` |
| Notifications | Triggered by standard terminal escape sequences (OSC 9/99/777) or CLI commands |

---

## 9. Installation and Pricing

- **Installation**: Download for macOS (`/download/confirmation?dl=1`)
- **Pricing**: Completely free and open source
- **Founders Edition** (optional): An option for early access to upcoming features (cmux AI, iOS app, Cloud VMs) and to support development

---

## 10. Platform & Highlights

- **Not a Ghostty fork**: Uses libghostty as a rendering library (similar to how apps use WebKit)
- **Platform limitation**: Currently macOS only. Linux, Windows, and Android are in development (a waitlist is available)
- **iOS app**: A "cmux BETA" beta is available on TestFlight
- **Compared to tmux**: Offers a GUI-native experience with vertical tabs and a built-in browser instead of terminal-based multiplexing

---

## 11. Community Reception

Prominent figures, including Ghostty creator Mitchell Hashimoto, have endorsed it, and praise continues for its notification system, vertical tabs, and improved multitasking efficiency. Many users report using it as their primary terminal, replacing iTerm2 and Warp.
