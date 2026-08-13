#!/usr/bin/env node
/**
 * MapSpec v1 CLI 校验入口(零依赖,可复现)。
 *
 * 校验逻辑的唯一实现在 skill/renderer/validate-map-spec.mjs(共享模块,
 * v3.2.13 P0-2);build-html.mjs(生成前校验)与 tests/mapspec/run-tests.mjs
 * (运行器)共用同一实现。本文件只做 CLI 参数解析、文件读取与结果输出。
 *
 * 用法:
 *   node tests/mapspec/validate.mjs <mapspec.json> [更多文件...] [--allow-test-fixture] [--repo-root <dir>]
 *   --allow-test-fixture: 允许 languageProfile === 'fixture' 的测试专用 MapSpec,
 *     且仅对 tests/<任意子目录>/fixtures/ 下的文件生效(v3.2.13 P1-3);
 *     生产 build-html 不带此 flag,必须拒绝测试标记。
 *   --repo-root <dir>: 可选。校验 evidence.path 解析后不越出该仓库根
 *     (realpath 判定,防 symlink 逃逸,v3.2.13 P1-2)。
 *   无参数运行: 打印用法并以退出码 1 结束(不静默通过)。
 * 退出码: 0 = 全部通过; 1 = 任一失败(打印每处错误)。
 *
 * 注意:这是零依赖的有限预检,覆盖 schema 核心约束 + build-rules 可执行部分;
 * 完整严格校验(ajv-cli + --strict-required,锁定版)在实施阶段经 package.json
 * 固定版本后由开发/CI 另行执行(build-rules.strictValidationCommand)。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMapSpec } from '../../skill/renderer/validate-map-spec.mjs';

// 真实 fixture 根(v3.2.14 P1-3):--allow-test-fixture 以 realpath containment 判定,
// 只认本仓库 tests/ 目录,路径片段伪装不再放行
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE_ROOTS = [path.join(REPO_ROOT, 'tests')];

function parseArgs(argv) {
  const args = { allowTestFixture: false, repoRoot: null, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--allow-test-fixture') {
      args.allowTestFixture = true;
    } else if (a === '--repo-root') {
      args.repoRoot = argv[++i];
      if (args.repoRoot === undefined) {
        console.error('错误: --repo-root 需要目录参数');
        process.exit(1);
      }
    } else {
      args.files.push(a);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

// 无参数:打印用法并退出 1
if (args.files.length === 0) {
  console.error('用法: node tests/mapspec/validate.mjs <mapspec.json> [更多文件...] [--allow-test-fixture] [--repo-root <dir>]');
  process.exit(1);
}

let failed = false;
for (const file of args.files) {
  let spec;
  try {
    spec = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`✗ ${file}: JSON 解析失败: ${e.message}`);
    failed = true;
    continue;
  }
  const errors = validateMapSpec(spec, {
    allowTestFixture: args.allowTestFixture,
    fixtureFilePath: file,
    fixtureRoots: FIXTURE_ROOTS,
    repoRoot: args.repoRoot,
  });
  if (errors.length) {
    console.error(`✗ ${file}: ${errors.length} 处错误`);
    errors.forEach((e) => console.error(`    - ${e}`));
    failed = true;
  } else {
    console.log(`✓ ${file}: 通过`);
  }
}
process.exit(failed ? 1 : 0);
