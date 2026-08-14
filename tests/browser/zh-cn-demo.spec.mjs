import { test, expect } from './runtime-dependencies.fixture.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const demoUrl = pathToFileURL(path.resolve('examples/demo/expected-output.zh-CN.html')).href;

test('中文 Demo 使用中文固定 UI 与中文业务内容', async ({ page }) => {
  await page.goto(demoUrl);
  await expect(page.locator('svg')).toBeVisible();
  await expect(page.locator('svg')).toHaveAttribute('data-icm-ui-locale', 'zh-CN');
  await expect(page.locator('.icm-legend')).toContainText('阅读说明');
  await expect(page.locator('.icm-legend')).toContainText('证据状态');
  await expect(page.locator('.icm-legend')).toContainText('操作');
  await page.locator('g.node[data-node-id="n1"]').click();
  await expect(page.locator('#detail-panel')).toContainText('创建订单');
  await expect(page.locator('#detail-panel .claim-state')).toHaveText('已验证');
  await expect(page.locator('#detail-panel button[aria-label="关闭详情"]')).toBeVisible();
});
