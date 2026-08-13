import { test, expect } from './runtime-dependencies.fixture.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const demoUrl = pathToFileURL(path.resolve('examples/demo/expected-output.html')).href;

// 渲染器可选可用性能力的回归测试；单次图谱是否以此作为验收项由 SKILL.md 中的用户确认决定。

test('键盘可聚焦节点、打开详情、关闭并恢复焦点', async ({ page }) => {
  await page.goto(demoUrl);
  let focusedNodeId = null;
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab');
    focusedNodeId = await page.evaluate(() => {
      const active = document.activeElement;
      return active?.matches('g.node[data-node-id]') ? active.getAttribute('data-node-id') : null;
    });
    if (focusedNodeId) break;
  }
  expect(focusedNodeId).toBeTruthy();
  await page.keyboard.press('Enter');
  await expect(page.locator('#detail-panel')).toBeVisible();
  await expect(page.locator('#detail-panel')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#detail-panel')).toHaveCount(0);
  await expect(page.locator('g.node[data-node-id="' + focusedNodeId + '"]')).toBeFocused();
});

test('桌面端详情是比例克制的右侧详情窗', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(demoUrl);
  await page.locator('g.node[data-node-id="n1"]').click();
  const panel = await page.locator('#detail-panel').boundingBox();
  if (!panel) throw new Error('详情面板未出现');
  expect(panel.width).toBeGreaterThanOrEqual(540);
  expect(panel.width).toBeLessThanOrEqual(622);
  expect(panel.width / 1440).toBeLessThanOrEqual(0.43);
  expect(panel.x + panel.width).toBeGreaterThanOrEqual(1422);
  expect(panel.y).toBeGreaterThanOrEqual(14);
  expect(panel.y + panel.height).toBeLessThanOrEqual(886);
});

test('打开详情后，选中节点居中于左侧可视画布', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(demoUrl);
  await page.locator('g.node[data-node-id="n1"]').click();
  await expect(page.locator('#detail-panel')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const viewport = document.querySelector('#graph-viewport').getBoundingClientRect();
    const panel = document.querySelector('#detail-panel').getBoundingClientRect();
    const node = document.querySelector('g.node[data-node-id="n1"]').getBoundingClientRect();
    const visibleCanvasCenter = viewport.left + (panel.left - viewport.left) / 2;
    return Math.abs(node.left + node.width / 2 - visibleCanvasCenter);
  })).toBeLessThanOrEqual(3);
});

test('窄屏详情是底部抽屉', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(demoUrl);
  await page.locator('g.node[data-node-id="n1"]').click();
  const panel = await page.locator('#detail-panel').boundingBox();
  if (!panel) throw new Error('详情面板未出现');
  expect(panel.y).toBeGreaterThan(667 * 0.35);
  expect(panel.y + panel.height).toBeGreaterThanOrEqual(665);
});
