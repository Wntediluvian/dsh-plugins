# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-08-18

### Changed
- **包名改为作用域包**：`dsh-backup` → `@wntediluvian/dsh-backup`（作者作用域，规范发布）

### Added
- **插件本体备份**：自动发现并备份用户自装插件（读取 profile `package.json` 的 `dependencies`，排除官方 `@deepseek-ai` 包）→ `插件本体\<插件名>\`，含插件代码与其自带配置
- **技能备份**：自动备份 `$DSH_HOME/skills\` 下全部用户技能（如 ponytail 系列）→ `技能\<技能名>\`
- **自动发现机制**：以后新装插件/技能，下次备份自动包含，无需改代码或重启
- **增量备份骨架**：即使文件未变化，也建立 `插件本体\`/`技能\` 目录结构，保证备份清单完整反映当时的插件安装情况
- **还原支持插件+技能**：还原范围新增「+插件」档位（`scope: 'plugins'`），可一并恢复插件本体与技能

## [0.1.1] - 2026-08-18

### Added
- **热重载配置**：设置页修改备份位置/间隔/保留后立即生效，无需重启 dsh
- **配置持久化**：`备份工作目录\config.json` 保存用户配置
- **自定义策略**：全量/增量间隔、保留数可配置（如每周全量、每小时增量）
- **设置 UI**：通用设置页新增"设置"分组（备份位置/全量间隔/增量间隔/全量保留/增量保留）
- **动态策略说明**：界面策略文字随配置实时变化

### Fixed
- **时间乱码**：修复 `NaN-NaN-NaN` 显示。根因：时间戳 `2026-08-18T024019`（无冒号）被 `new Date()` 解析失败，`getFullYear()` 静默返回 NaN（不抛异常故 catch 不触发）。修复：服务端 `stamp()` 改规范格式 + 前端 `fmtTime` 增加 `isNaN(d.getTime())` 容错
- **Windows 目录名 ENOENT**：修复备份目录名含冒号（`2026-08-18T02:40:19-增量`）导致 Windows 拒绝创建目录。修复：时间戳改为文件系统安全格式（去掉冒号）
- **配置作用域**：修复 `getConfig`/`setConfig` 定义在 `createEngine` 闭合括号之外导致引用闭包变量报 ReferenceError（500）。修复：移入引擎内部
- **TDZ 变量遮蔽**：修复 `const lastFullTime = await lastFullTime()` 变量名与函数名冲突导致的 `Cannot access before initialization`。修复：局部变量改名 `lastFullMs`

### Changed
- 备份判断逻辑：从固定"月/日"改为按配置间隔（距上次全量≥间隔→全量，否则距上次备份≥增量间隔→增量）
- 定时检查频率：按增量间隔的一半（clamp 1min~6h）
- 引擎路径改为可变配置驱动（函数形式），支撑热重载

## [0.1.0] - 2026-08-18

### Added
- 全量备份（默认每月，保留 2 份）
- 增量备份（默认每日，保留 30 天）
- 三触发：启动时 / 定时检查 / 会话结束
- 一键还原（含还原前快照，API key 永不覆盖）
- 记忆生成：按项目分类的人类可读完整时间线（会话标题 / 用户消息原文 / 关键操作）
- 通用设置页 UI 卡片（aqua 风格）+ 插件列表入口
- 5 个 HTTP API：status / history / backup / restore / config
- 备份工作目录与备份数据分离

### Fixed（开发期间解决的关键问题）
- **client 插件契约**：`ctx is not defined` —— dsh client 插件必须导出 `exports.apply(ctx)`，模块加载器通过该函数注入 ctx；不能直接在 factory 顶层调用 `registerCard(ctx)`
- **服务端注入方式**：`cannot get property "webServer" without inject` —— cordis 的 ctx 是代理对象，访问未声明属性直接抛错；必须用 `ctx.inject(['webServer'], (scope) => ...)`，且 scope 上的服务是 `scope.webServer`（不是 scope 本身）
- **函数作用域**：`registerRoutes is not defined` —— 路由注册函数定义在 `createEngine` 内部，apply 里无法直接引用；改为 `engine.registerRoutes(ws, engine)`
- **client slots 注入**：设置页卡片不显示 —— client 端必须用**顶层 `exports.inject = ['slots']`** 声明依赖（与 aqua 一致），不能像服务端那样用 scoped `ctx.inject(['slots'])`（client 端不生效，slot 注册从未执行）
- **React 获取**：卡片渲染报错 —— client 端通过 `require('react')` 从模块加载器获取（与 modlens 一致），不能依赖 `window.React`

### Notes
- 服务端 `lib/index.js` 仅使用 Node 内置模块（`node:fs`/`node:path`/`node:zlib`），零依赖
- 客户端 `lib/client.js` 手写 lazy-CJS bundle 协议，零构建，与 modlens 同构
- 当前为 **Windows 专用**（默认路径按 Windows 编写）；Linux/macOS 版规划中，服务端代码跨平台迁移成本低
