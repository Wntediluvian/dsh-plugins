# dsh-backup

DeepSeek Harness 的自动备份与还原插件。在设置页提供完整界面：备份状态、一键备份、历史列表、还原、自定义策略——全部**热重载生效，无需重启 dsh**。

> **平台**：**Windows 10/11**。默认路径、目录结构按 Windows 编写；Linux/macOS 支持规划中（服务端仅用 Node 内置模块，跨平台迁移成本低）。

---

## ✨ 主要功能

### 自动备份（三触发）
- **启动时**：dsh 启动后自动检查并补备份
- **定时**：按配置的增量间隔周期检查（默认每 6 小时检查一次）
- **会话结束时**：自动增量备份该会话所属项目

### 备份策略（可自定义）
| 项 | 默认值 | 说明 |
|---|---|---|
| 全量间隔 | 720 小时（每月） | 可设为每周(168h)等 |
| 增量间隔 | 24 小时（每天） | 可设为每小时(1h)等 |
| 全量保留 | 2 份 | 只留最新+上一份 |
| 增量保留 | 30 天 | 按天数保留 |
| 备份位置 | dsh 安装目录下的 `备份` 文件夹 | 可自定义 |

> **热重载**：在设置页修改后**立即生效**，无需重启 dsh。
> 判断逻辑：距上次全量 ≥ 全量间隔 → 全量；否则距上次任意备份 ≥ 增量间隔 → 增量。

### 记忆双重标准
- **对 dsh 可恢复**：备份保留原始会话文件（`session.jsonl.zstd`）+ storages，可直接放回数据目录
- **对人类可读**：自动生成 `记忆归档\<项目>\记忆.md`——按**时间顺序**的完整时间线（会话标题、用户消息原文、关键操作），按项目自动分类

### 还原
- 一键还原：选择备份点 → 选范围（仅会话+记忆 / +配置）→ 二次确认
- **还原前自动快照**当前状态到「还原前快照」
- **API key 永不覆盖**：`.credentials.yaml`、`modlens-config.json` 结构性排除

### 界面
- **通用设置页**：独立卡片区块（状态/立即备份/还原/设置）
- **插件列表**：同样提供入口

---

## 📦 安装

### 前置要求
- **操作系统**：Windows 10/11
- DeepSeek Harness（dsh）
- Node.js ≥ 22（dsh 自带所需运行时，插件本身仅用 node 内置模块）

### 安装步骤
```bash
# 克隆本仓库
git clone https://github.com/Wntediluvian/dsh-plugins.git
```
将 `dsh-plugins/dsh-backup` 目录复制到 web profile 的 `node_modules` 下：
```
$DSH_HOME/profiles/web/node_modules/dsh-backup/
```
然后在 `$DSH_HOME/profiles/web/package.json` 的 `dsh.profile.bundles` 中追加 `"dsh-backup"`，重启 dsh。

> **零依赖**：插件仅使用 Node.js 内置模块（`node:fs`/`node:path`/`node:zlib`），无需联网安装任何额外包。

### 目录结构
```
dsh-backup/
├── package.json        # dsh.client / exports 声明
├── cordis.patch.yml    # 挂载服务端插件
├── lib/
│   ├── index.js        # 服务端：备份引擎 + 路由 + 定时/事件 + 热重载
│   └── client.js       # 浏览器端：设置页卡片
├── README.md
└── CHANGELOG.md
```

---

## 🚀 使用

1. 启动 dsh → 插件自动加载，首次启动自动补备份
2. 打开 **设置 → 通用设置 → 备份**：
   - 查看备份状态（上次全量/增量、下次检查、备份位置、保留数）
   - 点「增量备份」或「全量备份」手动触发
   - 「还原」区选备份点 → 选范围 → 执行还原
   - 「设置」区改备份位置/间隔/保留 → **保存设置**（立即生效）

---

## 🔌 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/dsh-backup/status` | 备份状态 |
| GET | `/dsh-backup/history` | 备份历史 |
| POST | `/dsh-backup/backup` | `{type:'full'\|'incremental'}` 立即备份 |
| POST | `/dsh-backup/restore` | `{backup:<路径>, scope:'memory'\|'config'}` 还原 |
| GET/POST | `/dsh-backup/config` | 读/写配置（热重载） |

---

## ⚙️ 配置

持久化在 `<备份根目录>\备份工作目录\config.json`（设置页编辑，或手动改文件）：

```json
{
  "backupRoot": "<备份根目录>",
  "fullIntervalHours": 720,
  "incrementIntervalHours": 24,
  "fullRetention": 2,
  "incrementRetention": 30
}
```

> 手动改文件后重启 dsh 生效；设置页修改则立即生效。

---

## 🗂 备份目录结构

```
<备份根目录>\
├── 全量备份\           ← 全量（保留 N 份）
│   └── <时间戳>-全量\
│       ├── 会话\      ← 完整会话（原始层级）
│       ├── storages\
│       ├── 配置\      ← settings.yaml + 匿名ID（不含 API key）
│       ├── 插件配置\
│       ├── 记忆归档\
│       └── 备份清单.json
├── 增量备份\           ← 增量（保留 N 天）
│   └── <时间戳>-增量\
│       ├── 会话\      ← 有变化的会话
│       ├── 记忆归档\
│       └── 变更记录.json
└── 备份工作目录\        ← 运行时工作区（勿删）
    ├── config.json    ← 用户配置
    ├── 记忆归档\      ← 最新人类可读记忆
    └── 当前状态\      ← 最近备份镜像
```

---

## 🔒 安全

- 所有 API 仅响应 loopback（127.0.0.1/localhost）
- **还原永不写入** API key 文件（结构性排除，不会泄露他人 key）
- 所有后台操作 try-catch，失败只记日志，绝不影响 dsh 运行
- 配置热重载失败时自动回退到上次有效配置

---

## 🛠 开发

- **服务端** `lib/index.js`：零依赖（node 内置），代码跨平台友好
- **客户端** `lib/client.js`：手写 lazy-CJS bundle 协议，零构建，与 modlens 同构
- **Linux/macOS 支持**：规划中；服务端代码几乎可直接复用（调整默认路径与路径分隔符即可）

---

## 📄 License

MIT
