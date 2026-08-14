import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHtml } from '../../skill/renderer/build-html.mjs';
import { CDN_PROFILES } from '../../skill/renderer/deps.config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const buildHtml = path.join(repoRoot, 'skill', 'renderer', 'build-html.mjs');

let pass = 0;
let fail = 0;

function assert(condition, message) {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${message}`);
  } else {
    fail += 1;
    console.error(`  ✗ ${message}`);
  }
}

function baseSpec() {
  return {
    schemaVersion: 1,
    meta: { title: 't', question: 'q', scope: 's', languageProfile: 'js', summary: 'a' },
    nodes: [{
      id: 'n1',
      title: 'Node1',
      claimState: 'verified',
      evidence: [{ path: 'a.js', lineStart: 1, lineEnd: 2, state: 'verified' }],
      detail: { summary: 's', segments: [] },
    }],
  };
}

function runCli(args, cwd = repoRoot) {
  try {
    execFileSync('node', [buildHtml, ...args], { cwd, stdio: 'pipe' });
    return { code: 0, stderr: '' };
  } catch (error) {
    return { code: error.status ?? 1, stderr: error.stderr?.toString() ?? '' };
  }
}

function writeEvidenceFile(directory) {
  writeFileSync(path.join(directory, 'a.js'), 'line1\nline2\n');
}

console.log('== renderHtml 基本生成 ==');
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'icm-build-'));
  try {
    writeEvidenceFile(tmp);
  const html = renderHtml(baseSpec(), { repoRoot: tmp });
    assert(typeof html === 'string' && html.length > 0, 'renderHtml 返回非空 HTML');
    assert(html.includes('<html'), 'HTML 含 <html> 根');
    assert(html.includes('<title>t</title>'), 'MapSpec 标题写入 HTML title');
    assert(html.includes('Node1'), 'HTML 内联 MapSpec 节点标题');
    assert(!['__ICM_DOCUMENT_LANG__', '__ICM_DOCUMENT_TITLE__', '__ICM_GRAPH_VIEWPORT_LABEL__', '__ICM_FAILURE_HEADING__', '__ICM_FAILURE_SUMMARY__', '__ICM_FAILURE_RETRY__', '__ICM_STYLES_CSS__', '__ICM_RENDER_JS__', '__ICM_MAPSPEC_JSON__', '__ICM_DEPS_CONFIG_JSON__'].some((token) => html.includes(token)), '所有模板占位符均被替换');
  assert(html.includes('<html lang="en">') && html.includes('aria-label="Interactive code map"'), '英文产物使用英文文档语言与图谱区域名称');
  assert(html.includes('<h1>Failed to load dependencies</h1>') && html.includes('Check your network connection and try again later.'), '英文产物使用英文依赖失败页');
  assert(!html.includes(tmp) && !html.includes('/Users/'), 'HTML 不含 repoRoot 或用户绝对路径');
  assert(html.includes('Click a card for details'), '英文产物含面向读者的卡片详情提示');
  assert(html.includes("controls: 'Controls'") && html.includes("escapeAction: 'close'"), '英文产物含键盘操作说明');
  assert(html.includes("ariaLabel: 'Graph reading guide, evidence status, and controls'") && html.includes("role: 'group'"), '英文产物图例无障碍名称覆盖全部固定分组');
  assert(html.includes('@media (prefers-reduced-motion: reduce)') && html.includes('#graph-canvas svg g.node rect {\n    transition: none;\n  }'), '节点过渡遵循 reduced-motion');
  const chineseSpec = baseSpec();
  chineseSpec.meta.uiLocale = 'zh-CN';
  const chineseHtml = renderHtml(chineseSpec, { repoRoot: tmp });
  assert(chineseHtml.includes('<html lang="zh-CN">') && chineseHtml.includes('aria-label="交互式代码图谱"'), '中文产物使用中文文档语言与图谱区域名称');
  assert(chineseHtml.includes('<h1>依赖加载失败</h1>') && chineseHtml.includes('请检查网络连接后稍后重试。'), '中文产物使用中文依赖失败页');
  assert(chineseHtml.includes('点击图中卡片查看详情'), '中文产物本地化卡片详情提示');
  assert(chineseHtml.includes("controls: '操作'") && chineseHtml.includes("escapeAction: '关闭'"), '中文产物含键盘操作说明');
  assert(chineseHtml.includes("fit: '全图'") && chineseHtml.includes("fitAriaLabel: '缩放至完整图谱'"), '中文产物使用明确的全图缩放文案');
  const legacyChineseSpec = baseSpec();
  legacyChineseSpec.meta.languageProfile = 'zh-CN';
  const legacyChineseHtml = renderHtml(legacyChineseSpec, { repoRoot: tmp });
  assert(legacyChineseHtml.includes('<html lang="zh-CN">') && legacyChineseHtml.includes('<h1>依赖加载失败</h1>'), '旧版中文 MapSpec 的静态页面仍保持中文');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    const rendererScript = scripts.at(-1);
    let parseError = null;
    try {
      new Function(rendererScript);
    } catch (error) {
      parseError = error;
    }
    assert(typeof rendererScript === 'string' && !parseError, `最终内联 renderer 脚本可由 Function 解析${parseError ? `: ${parseError.message}` : ''}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\n== 已提交的双语 demo ==');
{
  const demoRepoRoot = path.join(repoRoot, 'examples', 'demo', 'sample-repo');
  const englishDemoSpec = JSON.parse(readFileSync(
    path.join(repoRoot, 'examples', 'demo', 'expected-mapspec.json'),
    'utf8',
  ));
  const chineseDemoSpec = JSON.parse(readFileSync(
    path.join(repoRoot, 'examples', 'demo', 'expected-mapspec.zh-CN.json'),
    'utf8',
  ));
  const chineseDemoHtml = renderHtml(chineseDemoSpec, { repoRoot: demoRepoRoot, cdnProfile: 'china-friendly' });
  const checkedInChineseDemoHtml = readFileSync(
    path.join(repoRoot, 'examples', 'demo', 'expected-output.zh-CN.html'),
    'utf8',
  );
  const checkedInEnglishDemoHtml = readFileSync(
    path.join(repoRoot, 'examples', 'demo', 'expected-output.html'),
    'utf8',
  );
  const englishDemoHtml = renderHtml(englishDemoSpec, { repoRoot: demoRepoRoot, cdnProfile: 'global' });
  assert(chineseDemoSpec.meta.uiLocale === 'zh-CN', '中文 demo 显式指定 zh-CN 固定 UI');
  assert(chineseDemoHtml.includes('<html lang="zh-CN">') && chineseDemoHtml.includes('<h1>依赖加载失败</h1>'), '中文 demo 的文档语言与失败页均本地化');
  assert(chineseDemoHtml.includes('<title>咖啡柜台订单流程</title>'), '中文 demo 使用中文页面标题');
  assert(chineseDemoHtml.includes('点击图中卡片查看详情') && chineseDemoHtml.includes('证据状态'), '中文 demo 的固定 UI 全部本地化');
  assert(chineseDemoHtml.includes('registry.npmmirror.com/react/18.3.1/files/umd/react.production.min.js'), '中文 demo 使用 npmmirror React 首源');
  assert(checkedInChineseDemoHtml.includes('registry.npmmirror.com/react/18.3.1/files/umd/react.production.min.js'), '已提交中文 HTML 保持 npmmirror 首源');
  assert(englishDemoHtml === checkedInEnglishDemoHtml, '已提交英文 HTML 可由当前 renderer 无漂移重建');
  assert(chineseDemoHtml === checkedInChineseDemoHtml, '已提交中文 HTML 可由当前 renderer 无漂移重建');
}

console.log('\n== </script> 注入防护 ==');
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'icm-inject-'));
  try {
    writeEvidenceFile(tmp);
    const spec = baseSpec();
    spec.nodes[0].title = '</script><script>window.__injected=true</script>';
    const html = renderHtml(spec, { repoRoot: tmp });
    const closingScriptCount = (html.match(/<\/script>/g) || []).length;
    assert(html.includes('<\\/script>'), '</script> 在内联 JSON 中被转义');
    assert(!html.includes('</script><script>window.__injected=true</script>'), '注入文本不闭合脚本块');
    assert(closingScriptCount === 2, '仅保留模板固有的两个真实脚本闭合标签');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\n== $ 特殊模式防护 ==');
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'icm-dollar-'));
  try {
    writeEvidenceFile(tmp);
    const spec = baseSpec();
    spec.nodes[0].detail.summary = 'use str.replace(/x/g, "$&") and $` $\' patterns';
    const html = renderHtml(spec, { repoRoot: tmp });
    assert(html.includes('$&'), '$& 字面保留在内联 MapSpec');
    assert(html.includes('use str.replace'), 'detail.summary 文本完整保留');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\n== 校验失败时不生成 ==');
{
  const bad = baseSpec();
  bad.schemaVersion = 2;
  let threw = false;
  try {
    renderHtml(bad, { repoRoot });
  } catch {
    threw = true;
  }
  assert(threw, 'schemaVersion 非法 → renderHtml 抛错');
}

console.log('\n== CDN profile 注入 ==');
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'icm-cdn-profile-'));
  try {
    writeEvidenceFile(tmp);
    const html = renderHtml(baseSpec(), { repoRoot: tmp, cdnProfile: 'china-friendly' });
    const depsMatch = html.match(/window\.__ICM_DEPS_CONFIG__ = (\[[\s\S]*?\]);/);
    const embedded = depsMatch ? JSON.parse(depsMatch[1]) : null;
    assert(JSON.stringify(embedded) === JSON.stringify(CDN_PROFILES['china-friendly']), 'china-friendly profile 被完整注入 HTML');
    assert(html.includes('registry.npmmirror.com/react/18.3.1/files/umd/react.production.min.js'), 'china-friendly React 首源写入 HTML');
    assert(html.includes('cdn.staticfile.org/react/18.3.1'), 'china-friendly React 保留 staticfile 回退');
    assert(html.includes('cdn.bootcdn.net/ajax/libs/react/18.3.1'), 'china-friendly React 末位回退写入 HTML');
    const defaultHtml = renderHtml(baseSpec(), { repoRoot: tmp });
    assert(!defaultHtml.includes('cdn.staticfile.org/react/18.3.1'), '默认 global profile 不注入 china-friendly 来源');
    let rejected = false;
    try {
      renderHtml(baseSpec(), { repoRoot: tmp, cdnProfile: 'fastest' });
    } catch (error) {
      rejected = error.message.includes('未知 CDN profile');
    }
    assert(rejected, 'renderHtml 拒绝未知 CDN profile');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\n== CLI ① --in/--out 同一文件拒绝 ==');
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'icm-same-'));
  try {
    writeEvidenceFile(tmp);
    writeFileSync(path.join(tmp, 'spec.json'), JSON.stringify(baseSpec()));
    const result = runCli(['--in', 'spec.json', '--out', 'spec.json', '--repo-root', tmp], tmp);
    assert(result.code !== 0, '同一文件 → 退出非 0');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\n== CLI ② --out 绝对路径拒绝 ==');
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'icm-absolute-out-'));
  try {
    writeEvidenceFile(tmp);
    writeFileSync(path.join(tmp, 'spec.json'), JSON.stringify(baseSpec()));
    const result = runCli(['--in', 'spec.json', '--out', path.join(tmp, 'out.html'), '--repo-root', tmp], tmp);
    assert(result.code !== 0, '--out 为绝对路径 → 退出非 0');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\n== CLI ③ 原子替换已存在 out ==');
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'icm-atomic-'));
  try {
    writeEvidenceFile(tmp);
    const specPath = path.join(tmp, 'spec.json');
    const outPath = path.join(tmp, 'out.html');
    writeFileSync(specPath, JSON.stringify(baseSpec()));
    writeFileSync(outPath, 'OLD CONTENT');
    const result = runCli(['--in', specPath, '--out', 'out.html', '--repo-root', tmp], tmp);
    assert(result.code === 0, '退出码 0');
    const output = readFileSync(outPath, 'utf8');
    assert(output.includes('<html') && !output.includes('OLD CONTENT'), 'out 被原子替换');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\n== CLI ④ 连续生成不留下临时文件 ==');
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'icm-tmp-'));
  try {
    writeEvidenceFile(tmp);
    const specPath = path.join(tmp, 'spec.json');
    writeFileSync(specPath, JSON.stringify(baseSpec()));
    runCli(['--in', specPath, '--out', 'out.html', '--repo-root', tmp], tmp);
    const result = runCli(['--in', specPath, '--out', 'out.html', '--repo-root', tmp], tmp);
    assert(result.code === 0, '连续两次生成成功');
    assert(!existsSync(path.join(tmp, 'out.html.tmp')), '无固定 tmp 残留');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\n== CLI ⑤ --out 为目录报错 ==');
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'icm-dir-'));
  try {
    writeEvidenceFile(tmp);
    writeFileSync(path.join(tmp, 'spec.json'), JSON.stringify(baseSpec()));
    mkdirSync(path.join(tmp, 'subdir'));
    const result = runCli(['--in', 'spec.json', '--out', 'subdir', '--repo-root', tmp], tmp);
    assert(result.code !== 0, '--out 指向目录 → 退出非 0');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\n== CLI ⑥ --repo-root 不存在或为文件报错 ==');
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'icm-root-'));
  try {
    writeEvidenceFile(tmp);
    const specPath = path.join(tmp, 'spec.json');
    writeFileSync(specPath, JSON.stringify(baseSpec()));
    const missing = runCli(['--in', specPath, '--out', 'o1.html', '--repo-root', path.join(tmp, 'nonexistent')], tmp);
    const fileRoot = runCli(['--in', specPath, '--out', 'o2.html', '--repo-root', path.join(tmp, 'a.js')], tmp);
    assert(missing.code !== 0, '--repo-root 不存在 → 退出非 0');
    assert(fileRoot.code !== 0, '--repo-root 为文件 → 退出非 0');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\n== CLI ⑦ 测试标记生产必拒 ==');
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'icm-fixture-'));
  try {
    const spec = baseSpec();
    spec.nodes[0].claimState = 'inferred';
    spec.nodes[0].evidence = [{ path: 'a.js', state: 'inferred' }];
    spec.meta.languageProfile = 'fixture';
    const specPath = path.join(tmp, 'spec.json');
    writeFileSync(specPath, JSON.stringify(spec));
    const result = runCli(['--in', specPath, '--out', 'o.html', '--repo-root', tmp], tmp);
    assert(result.code !== 0, 'languageProfile=fixture 生产必拒');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\n== CLI ⑧ verified 真实性端到端 ==');
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'icm-verify-'));
  try {
    writeEvidenceFile(tmp);
    const okPath = path.join(tmp, 'ok.json');
    const badPath = path.join(tmp, 'bad.json');
    writeFileSync(okPath, JSON.stringify(baseSpec()));
    const bad = baseSpec();
    bad.nodes[0].evidence[0].lineEnd = 99;
    writeFileSync(badPath, JSON.stringify(bad));
    const ok = runCli(['--in', okPath, '--out', 'ok.html', '--repo-root', tmp], tmp);
    const rejected = runCli(['--in', badPath, '--out', 'bad.html', '--repo-root', tmp], tmp);
    assert(ok.code === 0, 'verified 文件存在且行号在范围内 → 通过');
    assert(rejected.code !== 0, 'verified 行号越界 → 拒绝');
    assert(!existsSync(path.join(tmp, 'bad.html')), '拒绝时不写产物');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\n== CLI ⑨ CDN profile ==');
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'icm-cli-cdn-profile-'));
  try {
    writeEvidenceFile(tmp);
    writeFileSync(path.join(tmp, 'spec.json'), JSON.stringify(baseSpec()));
    const selected = runCli(['--in', 'spec.json', '--out', 'cn.html', '--repo-root', tmp, '--cdn-profile', 'china-friendly'], tmp);
    const selectedHtml = readFileSync(path.join(tmp, 'cn.html'), 'utf8');
    const rejected = runCli(['--in', 'spec.json', '--out', 'bad.html', '--repo-root', tmp, '--cdn-profile', 'fastest'], tmp);
    const missingValue = runCli(['--in', 'spec.json', '--out', 'missing.html', '--repo-root', tmp, '--cdn-profile'], tmp);
    assert(selected.code === 0 && selectedHtml.includes('registry.npmmirror.com/react/18.3.1/files/umd/react.production.min.js'), '--cdn-profile china-friendly 生成 npmmirror 首源');
    assert(rejected.code !== 0 && !existsSync(path.join(tmp, 'bad.html')), '未知 --cdn-profile 拒绝且不写产物');
    assert(missingValue.code !== 0 && !existsSync(path.join(tmp, 'missing.html')) && missingValue.stderr.includes('参数 --cdn-profile 缺少值'), '--cdn-profile 缺值明确拒绝且不写产物');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\n== 敏感二次扫描 ==');
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'icm-scan-'));
  try {
    writeEvidenceFile(tmp);
    const html = renderHtml(baseSpec(), { repoRoot: tmp });
    assert(html.length > 0, '正常 spec 的二次扫描通过');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
