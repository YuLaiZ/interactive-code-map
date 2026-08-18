# interactive-code-map

> **简体中文** | [English](README.md)

一个跨客户端 skill，将代码库证据或非代码业务流程描述转换为单个可交互的 HTML 证据图谱；它用结构化 MapSpec 分离调研与展示，并显式呈现证据状态。

## 效果演示

![交互式证据图谱演示：缩放、拖动、关系高亮、点击钉住与行号证据](docs/assets/interactive-code-map-demo.zh-CN.gif)

## 在线 Demo

- [中文 Demo](https://yulaiz.github.io/interactive-code-map/zh-CN/)
- [English demo](https://yulaiz.github.io/interactive-code-map/en/)

## 安装

可安装包是仓库中的 `skill/` 目录，必须保持其完整，包含 `SKILL.md`、`SKILL.zh-CN.md`、`renderer/` 与 `references/`。

随包提供供安装者阅读的 [Skill 中文译本](skill/SKILL.zh-CN.md)；`skill/SKILL.md` 仍是唯一执行入口。

### 全部目标 Agent 客户端

可把下面这段话直接发送给 Codex、ZCode、Claude Code、Claude Desktop Code 或 WorkBuddy：

> 请获取 `https://github.com/YuLaiZ/interactive-code-map`。使用当前客户端支持的 skill 安装机制，将其中的 `skill/` 目录安装为 `interactive-code-map` skill；保持该目录完整，包含 `SKILL.md`、`SKILL.zh-CN.md`、`renderer/` 与 `references/`。确认该 skill 可被发现，且能生成相对路径的 HTML 图谱。若当前客户端不能自行安装 skill，请报告准确的手工导入步骤；不要猜测内部目录，也不要创建软链接。

每个客户端自行管理安装位置，并不存在可移植的共享目录。这段指令是首选通用入口：由客户端选择其受支持的安装方式，不把机器专属路径写进项目。

### 本地或离线 checkout

当 Agent 已以本仓库作为工作区时，把上面指令的首句替换为：`请把当前工作区的 skill/ 目录安装为 interactive-code-map skill。` 其余完整性与降级要求不变。

只有当客户端明确支持、且你希望开发目录改动实时可见时，才使用开发态软链接；它不是发布安装合同。

## 手动生成 HTML 图谱

根据已检查的代码或资料创建 MapSpec 后，用选定证据根校验 verified 证据，并生成相对输出路径：

~~~bash
node skill/renderer/build-html.mjs \
  --in path/to/mapspec.json \
  --out docs/code-map.html \
  --repo-root path/to/evidence-root \
  --cdn-profile global
~~~

`--repo-root` 是证据根目录：代码图谱时为仓库根，非代码业务流程图谱时为用户资料所在目录。两种情况下 verified 证据都指向实际检查过的行；仅来自口述描述的断言保持 `inferred` 或 `unconfirmed`。

构建器会校验 MapSpec、内联应用代码和 CSS，并原子写入输出；它绝不会删除输入的 MapSpec。生成的 HTML 打开时需要联网加载固定版本的 React、ReactDOM 与 Mermaid 运行时依赖。

### CDN 交付 profile

- `global`（默认）：所有依赖均按 jsDelivr → unpkg 回退。
- `china-friendly`：React 与 ReactDOM 按 npmmirror → staticfile → jsDelivr → unpkg → bootcdn 回退；Mermaid 按 npmmirror → jsDelivr → unpkg 回退。

只有用户明确偏好中国大陆访问，或明确目标受众在中国大陆时，才选择 `china-friendly`。用户语言本身不足以决定 profile；只有构建环境能代表目标用户、且用户同意联网探测时，才适合根据实际速度选择。每个已配置来源均使用 HTTPS、固定版本、SRI 校验、8 秒超时，且只作为有序回退源。

生成前，Agent 会询问是否把键盘操作与小视口使用纳入本次图谱的验收范围。只有用户确认后，才承诺并验证这些能力；未选择不会阻塞图谱交付。

### 图内操作说明

每份生成图谱都有固定且本地化的三段说明：阅读说明、证据状态与操作。每张节点卡片的左上角还会直接显示与图例一致的小状态点，边框样式作为辅助提示。操作段会显示主要交互：点击卡片查看详情；点击任意关系线可钉住与悬停完全相同的高亮动画（同时仅一条，悬停机制不受影响），再次点击该线、按 `Esc` 或单击空白位置可取消，拖动画布不会误清；使用 `Tab` 选择卡片或关系线，`Enter` 打开或钉住，`Esc` 关闭详情面板并清除钉住。节点也支持空格作为等价的按钮操作。生成 HTML 的文档语言、图谱区域名称与依赖加载失败页也使用同一语言。上文的生成前确认仍决定键盘与小视口能力是否属于本次交付的验收范围。

可直接查看原创的[英文 MapSpec](examples/demo/expected-mapspec.json)与[中文 MapSpec](examples/demo/expected-mapspec.zh-CN.json)。两者共享同一个小型示例源码目录、图谱结构、断言状态和证据数据；仅图谱读者可见文案与固定 UI 按语言本地化。英文 Demo 使用 `global`；中文 Demo 明确面向中国大陆访问者，使用 `china-friendly`。可用以下命令重新生成已提交的 HTML：

~~~bash
node skill/renderer/build-html.mjs \
  --in examples/demo/expected-mapspec.json \
  --out examples/demo/expected-output.html \
  --repo-root examples/demo/sample-repo
~~~

~~~bash
node skill/renderer/build-html.mjs \
  --in examples/demo/expected-mapspec.zh-CN.json \
  --out examples/demo/expected-output.zh-CN.html \
  --repo-root examples/demo/sample-repo \
  --cdn-profile china-friendly
~~~

## 原则

- 仅包含原创实现和示例。
- MapSpec 证据状态明确为 `verified`、`inferred` 或 `unconfirmed`。
- 生成产物不得包含绝对本机路径、凭据或敏感源码内容。
- 运行时依赖固定版本，并通过受 SRI 保护的回退源加载。
- 键盘操作与小视口使用是推荐项，不是默认验收要求；Agent 会为每份图谱确认是否纳入。

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

## 验证

- npm run test:mapspec：验证零依赖校验器以及 Schema / 校验器包含关系。
- npm run test:build：验证 Mermaid 编码、依赖配置、构建安全和原子输出。
- npm run test:browser：验证渲染器回归，包括图谱加载、可选的键盘与响应式能力、平移缩放、CDN/SRI/超时回退、子图标题避让，以及长 htmlLabels 是否落在 foreignObject 可用尺寸内。测试期间使用字节级一致、经 SRI 校验的本地 UMD 镜像；生成的 HTML 本身仍使用固定的 CDN 源。

## 贡献

贡献指引见 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。

## 安全问题报告

漏洞报告方式见 [SECURITY.zh-CN.md](SECURITY.zh-CN.md)。

## 许可证

本项目采用 [MIT License](LICENSE)。
