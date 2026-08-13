# 为 interactive-code-map 贡献

> **简体中文** | [English](CONTRIBUTING.md)

感谢你帮助改进 interactive-code-map。欢迎提交 Bug 报告、文档改进、测试、
无障碍优化、渲染器改动和新示例。

## 开始前

- 新建 issue 或 Pull Request 前，先搜索已有内容。
- 较大功能、MapSpec 合同变更或大幅视觉重构，请先创建 issue 讨论范围与验收标准。
- 所有贡献必须保持原创。除非已明确审查许可与署名要求并确认兼容，否则不得从其他项目复制代码、样式、示例、提示词或文档。
- 不得在 issue、Pull Request、fixture 或示例中包含凭据、私钥、`.env` 文件、绝对本机路径或敏感源码内容。

## 开发环境

需要 Node.js 20 或更高版本。

~~~bash
npm ci
npm run test:mapspec
npm run test:build
~~~

仅在当前环境已有兼容浏览器时运行浏览器回归：

~~~bash
npm run test:browser
~~~

不要把安装 Playwright 浏览器作为贡献的隐式步骤。如确实需要下载浏览器，先说明下载内容并取得维护者同意。

## 变更要求

- 保持可安装的 `skill/` 目录自包含。`tests/` 与 `examples/` 用于开发和验证，不是已安装 skill 的运行时依赖。
- 修改 MapSpec 或校验逻辑时，同时更新可执行 Schema、共享校验器、构建规则及聚焦的正向或负向测试。
- 修改渲染器或可视行为时，先补聚焦的浏览器回归，再修复；若受影响，同步重新生成已提交 demo，并运行完整的相关测试集。
- 修改固定 UI 文案或交互行为时，在同一改动中同步更新中英文 README、两份 Skill 阅读文件、视觉质量合同及受影响的验收覆盖。
- 修改 CDN profile 时，同时更新批准来源顺序和 SRI 断言，并保持浏览器 fixture 会用锁定的本地 UMD 字节校验每个 profile 来源。不得加入未验证的 CDN 来源。
- 保留证据模型：断言必须标记为 `verified`、`inferred` 或 `unconfirmed`；`verified` 证据必须可追溯到已检查的相对路径和行范围。
- 保持 `README.md` 与 `README.zh-CN.md` 语义一致。`SKILL.md` 是唯一可执行 skill 入口；中文文件仅为阅读译本，不得添加发现用 frontmatter。

## Pull Request

- 每个 Pull Request 只处理一项连贯的改动。
- 说明问题、预期行为和已完成的验证。
- 可见 UI 改动适合时附截图或短录屏。
- 在同一个 Pull Request 中更新受影响文档和生成的 demo 输出。
- 使用清晰、祈使式的英文提交标题，不使用 conventional-commit 前缀。

## 安全问题

不要通过公开 issue 报告漏洞。请遵循 [SECURITY.zh-CN.md](SECURITY.zh-CN.md) 中的指引。
