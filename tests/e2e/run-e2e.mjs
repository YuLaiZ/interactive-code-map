#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

function usage() {
  console.error('用法: node tests/e2e/run-e2e.mjs --repo-root <代码目录> [--mapspec <文件>] [--html <相对 HTML>]');
}

function parseArgs(argv) {
  const result = { repoRoot: null, mapspec: null, html: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--repo-root') result.repoRoot = argv[++index];
    else if (value === '--mapspec') result.mapspec = argv[++index];
    else if (value === '--html') result.html = argv[++index];
    else throw new Error('未知参数: ' + value);
  }
  if (!result.repoRoot) throw new Error('缺少 --repo-root');
  return result;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.repoRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error('--repo-root 必须是存在的目录: ' + args.repoRoot);
  }
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) throw new Error('需要 Node.js >= 20，当前为 ' + process.versions.node);

  console.log('端到端验收准备完成。');
  console.log('1. 以该目录和业务问题运行 skill 工作流，先收集证据并生成 MapSpec。');
  console.log('2. 使用 build-html.mjs 生成相对路径下的单个 HTML，不自动打开浏览器。');
  console.log('3. 按 tests/e2e/rubric.md 的全部维度做人工验收并记录结论。');
  console.log('4. 在目标客户端完成本次所需的安装、发现与功能检查。');
  console.log('代码目录: ' + root);
  if (args.mapspec) console.log('待验 MapSpec: ' + args.mapspec);
  if (args.html) console.log('待验 HTML: ' + args.html);
} catch (error) {
  console.error('错误: ' + error.message);
  usage();
  process.exitCode = 1;
}
