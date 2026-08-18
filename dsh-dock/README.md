# 🛳️ dsh-dock

A **persistent balance dock** with **process control (restart / stop)** for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI (`dsh web`).

> Merged from **dsh-usage** (balance dock, token usage panel, activity heatmap) and **dsh-restart** (restart/stop process control), maintained as the user's own version in the `Wntediluvian/dsh-plugins` repo.

## ✨ Features

- **Balance dock** — embedded in the sidebar footer (glassmorphism, no drag handle): balance / today / month / cache-hit widgets, refresh & settings buttons.
- **Process control buttons** on the dock:
  - 🔴 **Stop** — gracefully shuts down the DSH process (SIGTERM)
  - 🟡 **Restart** — Node-native self-restart (detached helper + `windowsHide`, no console popups)
- **Detail panel** — click a widget to open the full balance/usage panel (rendered via portal, escapes backdrop-filter clipping).
- **Settings card** — in 插件 → 插件配置: restart method (legacy vs Node-native), auto-continue prompt, watchdog settings.
- **`restart_harness` tool** + **`/restart` command** — model-callable restart for reloading plugins and config.
- **Watchdog** (optional, off by default) — auto-relaunch DSH on crash/close.

## 📦 Install

```bash
dsh plugin --profile web add github:Wntediluvian/dsh-plugins#path:/dsh-dock
```

Or from a local checkout:

```bash
dsh plugin --profile web add file:D:\Program Files\harness\git\dsh-plugins\dsh-dock
```

## 🧩 What replaced what

| Upstream package | Role | Status |
|---|---|---|
| `dsh-usage` | balance dock / usage panel | merged → `dsh-dock` |
| `dsh-restart` | restart/stop process control | merged → `dsh-dock` |

After installing `dsh-dock`, remove `dsh-usage` and `dsh-restart` from the profile to avoid duplicate docks/buttons:

```bash
dsh plugin --profile web remove dsh-usage
dsh plugin --profile web remove dsh-restart
```

## 🛠 Server endpoints

- `GET /api/usage/providers` — configured providers + balance scheme/status
- `GET /api/usage/balance?provider=<id>` — balance for one provider
- `GET /api/usage/usage` — per-day token usage across every session
- `POST /dsh-dock/restart` — schedule a restart (loopback + same-origin guarded)
- `POST /dsh-dock/stop` — graceful stop (loopback + same-origin guarded)

## 📄 License

MIT — see [LICENSE](LICENSE). Original copyrights: dsh-usage contributors, dsh-restart contributors.
