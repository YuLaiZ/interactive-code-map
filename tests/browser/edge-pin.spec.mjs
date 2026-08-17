import { test, expect } from './runtime-dependencies.fixture.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const demoUrl = pathToFileURL(path.resolve('examples/demo/expected-output.html')).href;

test.describe('关系线点击钉住', () => {
  test('关系线 tooltip 按 uiLocale 本地化为英文', async ({ page }) => {
    await page.goto(demoUrl);
    const titles = await page.locator('g.edgeLabel[data-icm-hover-edge-id]').evaluateAll((labels) =>
      Array.from(new Set(labels.map((label) => label.getAttribute('title')))),
    );
    expect(titles).toEqual(['Hover to highlight this relationship; click to pin or unpin']);
  });

  test('点击条件胶囊钉住该关系，视觉与悬停同款且带描边框', async ({ page }) => {
    await page.goto(demoUrl);
    const condition = page.locator('g.edgeLabel[data-icm-label-kind="condition"]').first();
    const edgeId = await condition.getAttribute('data-icm-edge-id');
    expect(edgeId).toBeTruthy();

    await condition.click();
    await expect(page.locator('path.icm-edge-path.icm-edge-pinned[data-icm-hover-edge-id="' + edgeId + '"]')).toHaveCount(1);
    await expect(page.locator('g.edgeLabel.icm-edge-pinned[data-icm-hover-edge-id="' + edgeId + '"]')).toHaveCount(1);
    await expect(condition).toHaveAttribute('aria-pressed', 'true');

    // 钉住描边与悬停描边同层同款：每条被标记的关系一个 glow + 一个 flow。
    const outlineCount = await page.locator('g.icm-edge-hover-outline-layer > rect').count();
    expect(outlineCount).toBe(2);

    // 视觉与悬停完全一致：动画名相同，而不是另一套静态样式。
    const pinnedAnimation = await page.locator('path.icm-edge-path.icm-edge-pinned').evaluate((path) => getComputedStyle(path).animationName);
    await page.locator('.icm-toolbar').hover();
    const hoverAnimation = await page.evaluate(async () => {
      const path = document.querySelector('path.icm-edge-path.icm-edge-pinned');
      path.classList.add('icm-edge-hovered');
      const name = getComputedStyle(path).animationName;
      path.classList.remove('icm-edge-hovered');
      return name;
    });
    expect(pinnedAnimation).toBe('icm-edge-flow');
    expect(pinnedAnimation).toBe(hoverAnimation);
  });

  test('钉住是单选：点击另一条关系会替换，再次点击当前关系取消', async ({ page }) => {
    await page.goto(demoUrl);
    const labels = page.locator('g.edgeLabel[data-icm-label-kind="condition"]');
    const first = labels.nth(0);
    const second = labels.nth(1);
    const firstId = await first.getAttribute('data-icm-edge-id');
    const secondId = await second.getAttribute('data-icm-edge-id');
    expect(firstId).not.toBe(secondId);

    await first.click();
    await expect(page.locator('.icm-edge-path.icm-edge-pinned')).toHaveCount(1);

    await second.click();
    await expect(page.locator('path.icm-edge-path.icm-edge-pinned[data-icm-hover-edge-id="' + secondId + '"]')).toHaveCount(1);
    await expect(page.locator('path.icm-edge-path.icm-edge-pinned[data-icm-hover-edge-id="' + firstId + '"]')).toHaveCount(0);
    await expect(first).toHaveAttribute('aria-pressed', 'false');

    await second.click();
    await expect(page.locator('.icm-edge-path.icm-edge-pinned')).toHaveCount(0);
    // 鼠标仍悬停在该胶囊上：悬停描边框必须保留（悬停机制不受钉住影响）。
    await expect(page.locator('g.icm-edge-hover-outline-layer > rect')).toHaveCount(2);
    await page.locator('.icm-toolbar').hover();
    await page.locator('.icm-toolbar').hover();
    await expect(page.locator('g.icm-edge-hover-outline-layer > rect')).toHaveCount(0);
  });

  test('悬停机制不受钉住影响：悬停其他关系时钉住保持，两套描边共存', async ({ page }) => {
    await page.goto(demoUrl);
    const labels = page.locator('g.edgeLabel[data-icm-label-kind="condition"]');
    const pinned = labels.nth(0);
    const hovered = labels.nth(2);
    const hoveredId = await hovered.getAttribute('data-icm-edge-id');
    const pinnedId = await pinned.getAttribute('data-icm-edge-id');
    expect(hoveredId).not.toBe(pinnedId);

    await pinned.click();
    await expect(page.locator('.icm-edge-path.icm-edge-pinned')).toHaveCount(1);

    await hovered.hover();
    await expect(page.locator('path.icm-edge-path.icm-edge-hovered[data-icm-hover-edge-id="' + hoveredId + '"]')).toHaveCount(1);
    await expect(page.locator('path.icm-edge-path.icm-edge-pinned[data-icm-hover-edge-id="' + pinnedId + '"]')).toHaveCount(1);
    // 悬停 + 钉住各一组描边（glow + flow），共四条。
    await expect(page.locator('g.icm-edge-hover-outline-layer > rect')).toHaveCount(4);

    // 悬停离开后钉住依然常驻。
    await page.locator('.icm-toolbar').hover();
    await page.locator('.icm-toolbar').hover();
    await expect(page.locator('.icm-edge-path.icm-edge-hovered')).toHaveCount(0);
    await expect(page.locator('path.icm-edge-path.icm-edge-pinned[data-icm-hover-edge-id="' + pinnedId + '"]')).toHaveCount(1);
    await expect(page.locator('g.icm-edge-hover-outline-layer > rect')).toHaveCount(2);
  });

  test('Esc 清除钉住', async ({ page }) => {
    await page.goto(demoUrl);
    const condition = page.locator('g.edgeLabel[data-icm-label-kind="condition"]').first();
    await condition.click();
    await expect(page.locator('.icm-edge-path.icm-edge-pinned')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(page.locator('.icm-edge-path.icm-edge-pinned')).toHaveCount(0);
  });

  test('单击空白清除钉住，拖动画布则保持钉住', async ({ page }) => {
    await page.goto(demoUrl);
    const condition = page.locator('g.edgeLabel[data-icm-label-kind="condition"]').first();
    await condition.click();
    await expect(page.locator('.icm-edge-path.icm-edge-pinned')).toHaveCount(1);

    // 找一个真正的空白点（不属于节点、关系线或胶囊），避免起手点落在边元素上
    // 触发“边起手不平移”的新行为。
    const blank = await page.evaluate(() => {
      const viewport = document.getElementById('graph-viewport').getBoundingClientRect();
      for (let x = 24; x < viewport.width; x += 16) {
        for (let y = 24; y < viewport.height; y += 16) {
          const hit = document.elementFromPoint(viewport.left + x, viewport.top + y);
          // 必须落在图谱视口内（排除工具栏/图例等叠加 UI），且不属于节点或关系线。
          if (!hit || !hit.closest('#graph-viewport')) continue;
          if (hit.closest('g.node[data-node-id], [data-icm-hover-edge-id]')) continue;
          return { x: viewport.left + x, y: viewport.top + y };
        }
      }
      return null;
    });
    if (!blank) throw new Error('视口内找不到空白点');

    // 拖动画布（位移远超阈值）：钉住必须保持。
    const before = await page.evaluate(() => window.interactiveCodeMap.panZoom.getState());
    await page.mouse.move(blank.x, blank.y);
    await page.mouse.down();
    await page.mouse.move(blank.x + 120, blank.y + 80);
    await page.mouse.up();
    const after = await page.evaluate(() => window.interactiveCodeMap.panZoom.getState());
    expect(Math.hypot(after.tx - before.tx, after.ty - before.ty)).toBeGreaterThan(1);
    await expect(page.locator('.icm-edge-path.icm-edge-pinned')).toHaveCount(1);

    // 原地单击空白：钉住被清除。
    await page.mouse.move(blank.x + 20, blank.y + 20);
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.locator('.icm-edge-path.icm-edge-pinned')).toHaveCount(0);
  });

  test('点击节点打开详情面板，但不影响已钉住的关系', async ({ page }) => {
    await page.goto(demoUrl);
    const condition = page.locator('g.edgeLabel[data-icm-label-kind="condition"]').first();
    await condition.click();
    await expect(page.locator('.icm-edge-path.icm-edge-pinned')).toHaveCount(1);

    const node = page.locator('g.node[data-node-id]').first();
    await node.click();
    await expect(page.locator('#detail-panel h2')).toBeVisible();
    await expect(page.locator('.icm-edge-path.icm-edge-pinned')).toHaveCount(1);

    // 关闭节点面板后钉住仍在。
    await page.locator('#detail-panel .icm-close').click();
    await expect(page.locator('#detail-panel')).toHaveCount(0);
    await expect(page.locator('.icm-edge-path.icm-edge-pinned')).toHaveCount(1);
  });

  test('关系胶囊可通过键盘聚焦并用 Enter 钉住', async ({ page }) => {
    await page.goto(demoUrl);
    const condition = page.locator('g.edgeLabel[data-icm-label-kind="condition"]').first();
    const edgeId = await condition.getAttribute('data-icm-edge-id');

    await condition.focus();
    await expect(condition).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('path.icm-edge-path.icm-edge-pinned[data-icm-hover-edge-id="' + edgeId + '"]')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(page.locator('.icm-edge-path.icm-edge-pinned')).toHaveCount(0);
  });
});
