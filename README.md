# dsh-plugins

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件合集。

## 插件列表

| 插件 | 说明 | 版本 |
|---|---|---|
| [dsh-backup](./dsh-backup) | 自动备份与还原：全量/增量、三触发、热重载配置、记忆归档、设置页 UI | 0.1.1 |

## 安装

每个插件独立安装，见各插件目录的 README。

以 dsh-backup 为例：

```bash
# 克隆本仓库
git clone https://github.com/Wntediluvian/dsh-plugins.git
# 将插件目录放入 web profile 的 node_modules
# 并在 profiles/web/package.json 的 dsh.profile.bundles 中加入 "dsh-backup"
# 重启 dsh
```

## 平台

当前插件为 **Windows** 环境专用（Linux/macOS 版规划中）。

## License

MIT
