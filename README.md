# agy-agent-mcp

Model Context Protocol (MCP) server for **Antigravity CLI (`agy`)**, enabling you to use the autonomous AI coding agent `agy` across any MCP-compatible environment: **Zed**, **Claude Desktop**, **Cursor**, **Hermes**, **Continue**, **Cline**, and others.

---

## ✨ Features

- **Autonomous Agent via MCP**: Delegate coding, debugging, refactoring, and multi-step terminal tasks directly to `agy`.
- **Heartbeat & Activity Monitoring**: Periodic progress updates (every 15s) and watchdog protection against network stalls and dead connections.
- **Inactivity Watchdog**: Automatically detects hung or frozen processes (`inactivity_timeout_seconds`, default: 300s) to prevent runaway background executions.
- **Session Management**:
  - `agy_session_status`: Inspect active agent sessions, uptime, step count, and last activity timestamp.
  - `agy_cancel_session`: Terminate stuck or unwanted agent tasks by process PID or conversation ID.
  - Native `AbortSignal` handling: Automatically kills the spawned process if the MCP client cancels the request (e.g. clicking "Stop").
- **Multi-Turn Context & Sessions**: Continue existing conversations with conversational memory (`agy_continue` or explicit `conversation_id`).
- **Flexible Model & Parameter Overrides**: Select model (`gemini-3.8-flash-high`, `claude-sonnet-4-6`, `gemini-3.1-pro-high`, etc.), reasoning effort (`low`, `medium`, `high`, `xhigh`, `max`), and mode (`accept-edits` or `plan`).

---

## 🚀 Quick Start & Installation

### Option 1. Run without installation via `npx` (Recommended)

Any client can launch `agy-agent-mcp` on the fly without cloning or manual builds:
```bash
npx -y git+https://github.com/ewanni/agy-agent-mcp.git
```

---

### Option 2. Install globally via npm

```bash
npm install -g git+https://github.com/ewanni/agy-agent-mcp.git
```
This adds the `agy-agent-mcp` (and `agy-mcp`) binary directly to your `PATH`.

---

### Option 3. Clone and build locally

```bash
git clone https://github.com/ewanni/agy-agent-mcp.git
cd agy-agent-mcp
npm install
npm run build
npm link
```

---

## 🛠 Client Configuration

### 1. Zed (`~/.config/zed/settings.json`)

```json
{
  "context_servers": {
    "agy": {
      "command": "agy-agent-mcp",
      "args": []
    }
  },
  "context_server_timeout": 3600
}
```

> **Tip for Zed:** Set `"context_server_timeout": 3600` so Zed does not prematurely abort long-running autonomous tasks (default in Zed is 60s).

---

### 2. Claude Desktop (`claude_desktop_config.json`)

**MacOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Linux:** `~/.config/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "agy": {
      "command": "npx",
      "args": ["-y", "git+https://github.com/ewanni/agy-agent-mcp.git"]
    }
  }
}
```
*(Or set `"command": "agy-agent-mcp"` if installed globally).*

---

### 3. Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "agy": {
      "command": "agy-agent-mcp"
    }
  }
}
```

---

### 4. Hermes Agent

```bash
hermes mcp add agy agy-agent-mcp
```

---

### 5. Antigravity CLI (`agy`)

You can even attach `agy-agent-mcp` to `agy` itself:

```bash
agy mcp add agy agy-agent-mcp
```

---

## 🧰 Available Tools

| Tool | Description |
|---|---|
| `agy_agent` (alias: `agy_run`) | Run an autonomous task with the `agy` CLI agent. Parameters: `prompt`, `working_dir`, `add_dirs`, `model`, `effort`, `mode`, `timeout_seconds`, `inactivity_timeout_seconds`, `return_metadata`. |
| `agy_continue` | Continue a conversation turn. If `conversation_id` is omitted, resumes the most recent conversation session. |
| `agy_session_status` | View real-time active agent tasks, PID, uptime, steps completed, current phase, and time elapsed since last activity. |
| `agy_cancel_session` | Forcefully abort a running session by conversation ID or PID. |
| `agy_list_models` | List all available AI models supported by the installed `agy` CLI. |
| `agy_info` | Inspect `agy` CLI binary path, version, and active session count. |

---

## ⚙️ Environment Variables

- `AGY_PATH` — Path to the `agy` executable (defaults to `~/.local/bin/agy`, `/usr/local/bin/agy`, or resolved via system `PATH`).

---

## 📄 License

MIT © [ewanni](https://github.com/ewanni)
