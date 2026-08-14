import { test, expect } from './runtime-dependencies.fixture.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderHtml } from '../../skill/renderer/build-html.mjs';

const demoUrl = pathToFileURL(path.resolve('examples/demo/expected-output.zh-CN.html')).href;
const legacyChineseSpec = JSON.parse(readFileSync('examples/demo/expected-mapspec.zh-CN.json', 'utf8'));
delete legacyChineseSpec.meta.uiLocale;
legacyChineseSpec.meta.languageProfile = 'zh-CN';

test('中文 Demo 使用中文固定 UI 与中文业务内容', async ({ page }) => {
  await page.goto(demoUrl);
  await expect(page.locator('svg')).toBeVisible();
  await expect(page.locator('svg')).toHaveAttribute('data-icm-ui-locale', 'zh-CN');
  await expect(page.locator('.icm-legend')).toContainText('阅读说明');
  await expect(page.locator('.icm-legend')).toContainText('证据状态');
  await expect(page.locator('.icm-legend')).toContainText('操作');
  await expect(page.locator('g.node[data-node-id="n13"] .icm-node-evidence-marker')).toHaveAttribute('data-claim-state', 'inferred');
  await expect(page.locator('g.node[data-node-id="n13"] .icm-node-evidence-marker title')).toHaveText('推断');
  await page.locator('g.node[data-node-id="n1"]').click();
  await expect(page.locator('#detail-panel')).toContainText('创建订单');
  await expect(page.locator('#detail-panel .claim-state')).toHaveText('已验证');
  await expect(page.locator('#detail-panel button[aria-label="关闭详情"]')).toBeVisible();
});

test('缺少 uiLocale 的旧中文 MapSpec 仍本地化节点状态点', async ({ page }) => {
  const html = renderHtml(legacyChineseSpec, {
    repoRoot: path.resolve('examples/demo/sample-repo'),
    cdnProfile: 'china-friendly',
  });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('svg')).toHaveAttribute('data-icm-ui-locale', 'zh-CN');
  const inferredNode = page.locator('g.node[data-node-id="n13"]');
  await expect(inferredNode).toHaveAttribute('aria-label', '退款路径 — 推断');
  await expect(inferredNode.locator('.icm-node-evidence-marker title')).toHaveText('推断');
});
