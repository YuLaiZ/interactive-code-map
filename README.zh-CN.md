# interactive-code-map

> **简体中文** | [English](README.md)

一个跨客户端 skill，将代码库证据转换为单个可交互的 HTML 代码图谱；它用结构化 MapSpec 分离调研与展示，并显式呈现证据状态。

## 原则

- 仅包含原创实现和示例。
- MapSpec 证据状态明确为 `verified`、`inferred` 或 `unconfirmed`。
- 生成产物不得包含绝对本机路径、凭据或敏感源码内容。
- 运行时依赖固定版本，并通过受 SRI 保护的回退源加载。
- 键盘操作与小视口使用是推荐项，不是默认验收要求；Agent 会为每份图谱确认是否纳入。

## 安装

可安装包是仓库中的 `skill/` 目录，必须保持其完整，包含 `SKILL.md`、`SKILL.zh-CN.md`、`renderer/` 与 `references/`。

随包提供供安装者阅读的 [Skill 中文译本](skill/SKILL.zh-CN.md)；`skill/SKILL.md` 仍是唯一执行入口。

### 全部目标 Agent 客户端

本仓库上传后，可把下面这段话直接发送给 Codex、ZCode、Claude Code、Claude Desktop Code 或 WorkBuddy：

> 请获取 `https://github.com/YuLaiZ/interactive-code-map`。使用当前客户端支持的 skill 安装机制，将其中的 `skill/` 目录安装为 `interactive-code-map` skill；保持该目录完整，包含 `SKILL.md`、`SKILL.zh-CN.md`、`renderer/` 与 `references/`。确认该 skill 可被发现，且能生成相对路径的 HTML 图谱。若当前客户端不能自行安装 skill，请报告准确的手工导入步骤；不要猜测内部目录，也不要创建软链接。

每个客户端自行管理安装位置，并不存在可移植的共享目录。这段指令是首选通用入口：由客户端选择其受支持的安装方式，不把机器专属路径写进项目。

### 本地或离线 checkout

当 Agent 已以本仓库作为工作区时，把上面指令的首句替换为：`请把当前工作区的 skill/ 目录安装为 interactive-code-map skill。` 其余完整性与降级要求不变。

只有当客户端明确支持、且你希望开发目录改动实时可见时，才使用开发态软链接；它不是发布安装合同。

## 开发

需要 Node.js 20 或更高版本。

~~~bash
npm install
npm run test:mapspec
npm run test:build
# 仅在当前环境已有兼容浏览器时运行：
npm run test:browser
~~~

`npm test` 会在已配置好的开发或 CI 环境中运行三组测试。浏览器回归应先复用 Playwright 配置可访问的现有兼容浏览器；macOS 本地可使用已安装的 Google Chrome。若没有兼容浏览器，应把 `npx playwright install chromium` 作为独立的可选安装建议，说明它会下载 Chromium，并等待用户确认后再执行。skill 的冒烟验证不会自行安装浏览器工具。

## 生成 HTML 图谱

根据已检查的代码创建 MapSpec 后，用选定仓库根校验 verified 证据，并生成相对输出路径：

~~~bash
node skill/renderer/build-html.mjs \
  --in path/to/mapspec.json \
  --out docs/code-map.html \
  --repo-root path/to/repository
~~~

构建器会校验 MapSpec、内联应用代码和 CSS，并原子写入输出；它绝不会删除输入的 MapSpec。生成的 HTML 在运行时使用固定版本、SRI 保护的 React、ReactDOM 与 Mermaid CDN 源，因此打开时需要网络。

生成前，Agent 会询问是否把键盘操作与小视口使用纳入本次图谱的验收范围。只有用户确认后，才承诺并验证这些能力；未选择不会阻塞图谱交付。

可直接查看原创示例：[examples/demo/expected-mapspec.json](examples/demo/expected-mapspec.json)、其小型示例源目录以及 [examples/demo/expected-output.html](examples/demo/expected-output.html)。可用以下命令重新生成已提交的 HTML：

~~~bash
node skill/renderer/build-html.mjs \
  --in examples/demo/expected-mapspec.json \
  --out examples/demo/expected-output.html \
  --repo-root examples/demo/sample-repo
~~~

## 在线 Demo

在 GitHub Pages 的发布源设为 GitHub Actions 后，同一份原创 demo 可通过 [yulaiz.github.io/interactive-code-map](https://yulaiz.github.io/interactive-code-map/) 查看。

## 验证

- npm run test:mapspec：验证零依赖校验器以及 Schema / 校验器包含关系。
- npm run test:build：验证 Mermaid 编码、依赖配置、构建安全和原子输出。
- npm run test:browser：验证渲染器回归，包括图谱加载、可选的键盘与响应式能力、平移缩放、CDN/SRI 回退、子图标题避让，以及长 htmlLabels 是否落在 foreignObject 可用尺寸内。测试期间使用字节级一致、经 SRI 校验的本地 UMD 镜像；生成的 HTML 本身仍使用固定的 CDN 源。

## 安全问题报告

漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## 许可证

本项目采用 [MIT License](LICENSE)。
