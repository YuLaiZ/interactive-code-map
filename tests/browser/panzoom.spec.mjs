import { test, expect } from './runtime-dependencies.fixture.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const demoUrl = pathToFileURL(path.resolve('examples/demo/expected-output.html')).href;

test('滚轮缩放保持鼠标锚点不变', async ({ page }) => {
  await page.goto(demoUrl);
  const viewport = page.locator('#graph-viewport');
  const box = await viewport.boundingBox();
  if (!box) throw new Error('缺少 graph viewport');
  const anchor = { x: box.width * 0.37, y: box.height * 0.61 };
  const before = await page.evaluate(() => window.interactiveCodeMap.panZoom.getState());
  const local = {
    x: (anchor.x - before.tx) / before.scale,
    y: (anchor.y - before.ty) / before.scale,
  };

  await page.mouse.move(box.x + anchor.x, box.y + anchor.y);
  await page.mouse.wheel(0, -300);

  const after = await page.evaluate(() => window.interactiveCodeMap.panZoom.getState());
  const mapped = {
    x: after.tx + local.x * after.scale,
    y: after.ty + local.y * after.scale,
  };
  expect(after.scale).toBeGreaterThan(before.scale);
  expect(Math.abs(mapped.x - anchor.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(mapped.y - anchor.y)).toBeLessThanOrEqual(2);
});

test('Fit 会让完整 SVG 落在视口范围内', async ({ page }) => {
  await page.goto(demoUrl);
  await page.getByRole('button', { name: 'Fit to screen' }).click();
  const svg = await page.locator('svg').boundingBox();
  const viewport = await page.locator('#graph-viewport').boundingBox();
  if (!svg || !viewport) throw new Error('缺少 SVG 或视口');
  expect(svg.width).toBeLessThanOrEqual(viewport.width + 10);
  expect(svg.height).toBeLessThanOrEqual(viewport.height + 10);
});

test('鼠标拖拽会平移画布', async ({ page }) => {
  await page.goto(demoUrl);
  const before = await page.evaluate(() => window.interactiveCodeMap.panZoom.getState());
  const viewport = await page.locator('#graph-viewport').boundingBox();
  if (!viewport) throw new Error('缺少 graph viewport');
  await page.mouse.move(viewport.x + 120, viewport.y + 120);
  await page.mouse.down();
  await page.mouse.move(viewport.x + 220, viewport.y + 200);
  await page.mouse.up();
  const after = await page.evaluate(() => window.interactiveCodeMap.panZoom.getState());
  expect(Math.hypot(after.tx - before.tx, after.ty - before.ty)).toBeGreaterThan(1);
});

test('在图谱上拖拽不会选中节点、分组或条件文字', async ({ page }) => {
  await page.goto(demoUrl);
  const viewport = await page.locator('#graph-viewport').boundingBox();
  const node = await page.locator('g.node[data-node-id="n1"]').boundingBox();
  if (!viewport || !node) throw new Error('缺少图谱视口或首个节点');

  await page.mouse.move(node.x + node.width / 2, node.y + node.height / 2);
  await page.mouse.down();
  await page.mouse.move(Math.min(viewport.x + viewport.width - 16, node.x + node.width / 2 + 90), node.y + node.height / 2 + 40);
  await page.mouse.up();

  expect(await page.evaluate(() => window.getSelection()?.toString() || '')).toBe('');
  expect(await page.locator('#graph-canvas').evaluate((canvas) => getComputedStyle(canvas).userSelect)).toBe('none');
});

test('双触点 pinch 只缩放内层画布', async ({ page }) => {
  await page.goto(demoUrl);
  const viewport = page.locator('#graph-viewport');
  const viewportBefore = await viewport.boundingBox();
  const stateBefore = await page.evaluate(() => window.interactiveCodeMap.panZoom.getState());
  await viewport.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 180 });
  await viewport.dispatchEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 220, clientY: 180 });
  await viewport.dispatchEvent('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 180 });
  await viewport.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 180 });
  await viewport.dispatchEvent('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 180 });
  const stateAfter = await page.evaluate(() => window.interactiveCodeMap.panZoom.getState());
  const viewportAfter = await viewport.boundingBox();
  expect(stateAfter.scale).toBeGreaterThan(stateBefore.scale);
  expect(viewportAfter).toEqual(viewportBefore);
});
