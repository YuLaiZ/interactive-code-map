#!/usr/bin/env node
/**
 * MapSpec → 单文件 HTML 的零依赖构建入口。
 *
 * 用法：node build-html.mjs --in <mapspec> --out <relative-html> --repo-root <root>
 *        [--allow-test-fixture]
 */
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  containsAbsoluteFilesystemPath,
  isSensitiveContent,
  isSensitivePath,
  validateMapSpec,
} from './validate-map-spec.mjs';
import { ALL_DEPS } from './deps.config.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const template = readFileSync(path.join(directory, 'template.html'), 'utf8');
const renderSource = readFileSync(path.join(directory, 'render.js'), 'utf8');
const encoderSource = readFileSync(path.join(directory, 'mermaid-encoder.mjs'), 'utf8');
const dslSource = readFileSync(path.join(directory, 'mapspec-to-mermaid.mjs'), 'utf8');
const styles = readFileSync(path.join(directory, 'styles.css'), 'utf8');

/**
 * 将当前允许的 ESM 形态转换为可内联的普通脚本。
 *
 * 只允许单行命名 import 和 export function。新模块语法必须显式引入
 * AST 转换方案，而不能被宽松正则静默删除。
 */
function stripModuleSyntax(source, sourceName) {
  const output = [];
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*import\b/.test(line)) {
      const supported = /^\s*import\s+\{[^}\r\n]+\}\s+from\s+['"][^'"\r\n]+['"];?\s*$/.test(line);
      if (!supported) {
        throw new Error(`${sourceName} 含当前内联器不支持的 import 语法: ${line.trim()}`);
      }
      continue;
    }
    if (/^\s*export\b/.test(line)) {
      const supported = /^\s*export\s+function\s+[A-Za-z_$][\w$]*\s*\(/.test(line);
      if (!supported) {
        throw new Error(`${sourceName} 含当前内联器不支持的 export 语法: ${line.trim()}`);
      }
      output.push(line.replace(/^(\s*)export\s+/, '$1'));
      continue;
    }
    output.push(line);
  }
  const stripped = output.join('\n');
  if (/^\s*(?:import|export)\b/m.test(stripped)) {
    throw new Error(`${sourceName} 内联后仍残留 ESM 语法`);
  }
  return stripped;
}

function safeForScript(value) {
  // HTML 的 script raw-text 解析只会由 `</script` 结束；不能替换所有 `</`，
  // 否则像 /</g 这样的合法 JavaScript 正则会被破坏。
  return String(value).replace(/<\/script/gi, '<\\/script');
}

function safeForStyle(value) {
  return String(value).replace(/<\/style/gi, '<\\/style');
}

function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function replaceToken(documentText, token, value) {
  if (!documentText.includes(token)) {
    throw new Error(`模板缺少占位符: ${token}`);
  }
  return documentText.split(token).join(value);
}

/**
 * 生成单文件 HTML。
 *
 * @throws {Error} MapSpec 校验、模块内联或敏感内容检查失败时抛出错误。
 */
export function renderHtml(mapSpec, options = {}) {
  const {
    repoRoot = null,
    allowTestFixture = false,
    fixtureFilePath = null,
    fixtureRoots = null,
  } = options;
  const errors = validateMapSpec(mapSpec, {
    repoRoot,
    allowTestFixture,
    fixtureFilePath,
    fixtureRoots,
  });
  if (errors.length > 0) {
    throw new Error(`MapSpec 校验失败:\n  - ${errors.join('\n  - ')}`);
  }

  const rendererScript = [
    stripModuleSyntax(encoderSource, 'mermaid-encoder.mjs'),
    stripModuleSyntax(dslSource, 'mapspec-to-mermaid.mjs'),
    renderSource,
  ].join('\n');

  let html = template;
  html = replaceToken(html, '__ICM_DOCUMENT_TITLE__', escapeHtmlText(mapSpec.meta.title));
  html = replaceToken(html, '__ICM_STYLES_CSS__', safeForStyle(styles));
  html = replaceToken(html, '__ICM_RENDER_JS__', safeForScript(rendererScript));
  html = replaceToken(html, '__ICM_MAPSPEC_JSON__', safeForScript(JSON.stringify(mapSpec)));
  html = replaceToken(html, '__ICM_DEPS_CONFIG_JSON__', safeForScript(JSON.stringify(ALL_DEPS)));

  if (isSensitiveContent(html) || isSensitivePath(html) || containsAbsoluteFilesystemPath(html)) {
    throw new Error('生成 HTML 含敏感内容或绝对文件系统路径，请修正 MapSpec 或 renderer 源码');
  }
  return html;
}

function parseArgs(argv) {
  const args = {
    allowTestFixture: false,
    input: null,
    output: null,
    repoRoot: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--in') {
      args.input = argv[++index];
    } else if (argument === '--out') {
      args.output = argv[++index];
    } else if (argument === '--repo-root') {
      args.repoRoot = argv[++index];
    } else if (argument === '--allow-test-fixture') {
      args.allowTestFixture = true;
    } else {
      throw new Error(`未知参数: ${argument}`);
    }
  }
  if (!args.input || !args.output || !args.repoRoot) {
    throw new Error('用法: node build-html.mjs --in <mapspec> --out <relative-html> --repo-root <root> [--allow-test-fixture]');
  }
  return args;
}

function createTemporaryOutput(outPath, content) {
  const outDirectory = path.dirname(outPath);
  const base = path.basename(outPath);
  let tmpPath = null;
  let descriptor = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    tmpPath = path.join(outDirectory, `.${base}.${crypto.randomBytes(8).toString('hex')}.tmp`);
    try {
      descriptor = openSync(tmpPath, 'wx');
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  if (descriptor === null || tmpPath === null) {
    throw new Error('无法创建唯一临时输出文件');
  }

  try {
    writeFileSync(descriptor, content);
    closeSync(descriptor);
    descriptor = null;
    renameSync(tmpPath, outPath);
  } catch (error) {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // 原始写入错误才是主错误。
      }
    }
    try {
      unlinkSync(tmpPath);
    } catch {
      // 临时文件若不存在或已由 rename 消费，不覆盖原始错误。
    }
    throw error;
  }
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`错误: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (path.isAbsolute(args.output)) {
    console.error('错误: --out 必须是相对路径');
    process.exitCode = 1;
    return;
  }

  const inputPath = path.resolve(process.cwd(), args.input);
  const outputPath = path.resolve(process.cwd(), args.output);
  const rootPath = path.resolve(process.cwd(), args.repoRoot);

  try {
    if (existsSync(inputPath) && existsSync(outputPath)
      && realpathSync(inputPath) === realpathSync(outputPath)) {
      throw new Error('--in 与 --out 指向同一文件');
    }

    const mapSpec = JSON.parse(readFileSync(inputPath, 'utf8'));
    const options = { repoRoot: rootPath };
    if (args.allowTestFixture) {
      options.allowTestFixture = true;
      options.fixtureFilePath = realpathSync(inputPath);
      options.fixtureRoots = [path.join(realpathSync(rootPath), 'tests')];
    }
    const html = renderHtml(mapSpec, options);
    createTemporaryOutput(outputPath, html);
    console.log(`生成: ${args.output}`);
  } catch (error) {
    console.error(`错误: ${error.message}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) main();
