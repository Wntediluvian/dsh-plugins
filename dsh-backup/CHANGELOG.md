# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.2.3] - 2026-08-19

### Added
- **注册 settings namespace**：`installSettingsSection(ctx, settingsNamespace('dsh-backup'), ...)` —— 使「DSH 备份」卡片出现在 设置 → 插件 → 插件配置 列表（与 DSH 重启同列表）。此前仅注册 `settings.plugin.item` 不生效（该页只渲染有 namespace 的插件）
- **可折叠卡片外壳**：备份卡片加 `<li>` + 标题栏 + 折叠箭头（与 DSH 重启外观一致），默认折叠

### Changed
- **移除通用设置页卡片**：备份卡片只出现在插件配置页，不再出现在通用设置页（去掉 `settings.general.item` 注册）

### Fixed
- **插件列表卡片此前一直不显示**：真正根因是缺 settings namespace（0.2.2 的 key 修复是必要条件但非充分条件）

## [0.2.2] - 2026-08-19

### Fixed
- **插件列表卡片不显示（部分）**：`settings.plugin.item` 是 keyed slot 需用 `key`（已改）。**注：完整根因是缺 settings namespace，见 0.2.3**

## [0.2.1] - 2026-08-18

### Fixed
- **作用域包加载失败**：`cordis.patch.yml` 中插件挂载名仍为旧裸名 `dsh-backup`，导致 loader 按包名 import 时报 `Cannot find package 'dsh-backup'`。修复：改为完整包名 `@wntediluvian/dsh-backup`
- **客户端模块注册失败**：`client.js` 中 `__ModuleLoader__.load({ id: 'dsh-backup' })` 注册名与包名不符，导致客户端报 `loaded without registering "@wntediluvian/dsh-backup"`。修复：改为 `id: '@wntediluvian/dsh-backup'`（与 modlens 的作用域包模式一致：patch name / client id 用完整包名，代码内注册名保留短名）

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
