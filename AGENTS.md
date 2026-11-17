# dsh-plugins 智能体规则

本文件给在本仓库工作的智能体看：只写硬约束，细节以 README 和代码为准。

## 版本

- 版本号用 `vX.Y.Z`（语义化版本：不兼容的改动加主版本，新增功能加次版本，修正加修订号），只由**附注标签 + GitHub Release** 确认；`CHANGELOG.md` 记每个版本改了什么。
- 改动合并后先登记到 `CHANGELOG.md` 的 `[Unreleased]`；一次上线、交付或一批改动完成就发一个版本，不让改动长期挂在未发布里。
- 发布步骤：把 `[Unreleased]` 落到新版本小节（写日期）→ 提交，标题末尾带 `(vX.Y.Z)` → `git tag -a vX.Y.Z -m "vX.Y.Z: 一句话摘要"` → `git push origin vX.Y.Z`（标签单独推）→ 建 GitHub Release，说明用该版本小节。
- 已推送的标签不移动、不删除；要修正就递增版本号另发。完整规则见知识库《Git 与版本管理约定》《GitHub 仓库治理规范》。
