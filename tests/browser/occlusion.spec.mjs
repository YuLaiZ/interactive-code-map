import { test, expect } from './runtime-dependencies.fixture.mjs';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const fixtureRelative = 'tests/browser/fixtures/.tmp-occlusion.html';
const fixturePath = path.resolve(fixtureRelative);
const fixtureInput = path.resolve('tests/browser/fixtures/subgraph-title-occlusion.mapspec.json');
const builder = path.resolve('skill/renderer/build-html.mjs');

function buildFixtureHtml() {
  execFileSync('node', [
    builder,
    '--in', fixtureInput,
    '--out', fixtureRelative,
    '--repo-root', process.cwd(),
    '--allow-test-fixture',
  ], { stdio: 'pipe' });
  return pathToFileURL(fixturePath).href;
}

async function loadFixture(page, fixtureUrl) {
  await page.goto(fixtureUrl);
  await expect(page.locator('svg')).toBeVisible();
}

// 通过标题父组的本地坐标移动，而不是将 CSS 像素直接当作 SVG 单位。
async function setFirstLabelVerticalGap(page, gapPx) {
  return page.evaluate((desiredGap) => {
    const svg = document.querySelector('svg');
    const label = document.querySelector('.cluster-label');
    if (!svg || !label) throw new Error('fixture 缺少 svg 或 cluster-label');
    const node = [...document.querySelectorAll('g.node')].find((candidate) => {
      const a = label.getBoundingClientRect();
      const b = candidate.getBoundingClientRect();
      return a.left < b.right && b.left < a.right;
    });
    if (!node) throw new Error('fixture 缺少横向候选节点');
    const labelRect = label.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const parent = label.parentNode;
    const toParent = (x, y) => {
      const point = svg.createSVGPoint();
      point.x = x;
      point.y = y;
      return point.matrixTransform(parent.getScreenCTM().inverse());
    };
    const before = toParent(labelRect.left, labelRect.top);
    const target = toParent(labelRect.left, labelRect.top + (nodeRect.top - desiredGap - labelRect.bottom));
    const existing = label.getAttribute('transform') || '';
    label.setAttribute('transform', (existing + ' translate(0,' + (target.y - before.y) + ')').trim());
  }, gapPx);
}

async function candidateGapStatus(page) {
  return page.evaluate(() => {
    const label = document.querySelector('.cluster-label').getBoundingClientRect();
    const nodes = [...document.querySelectorAll('g.node')]
      .map((node) => node.getBoundingClientRect())
      .filter((node) => label.left < node.right && node.left < label.right);
    const gap = (a, b) => Math.hypot(
      Math.max(0, a.left - b.right, b.left - a.right),
      Math.max(0, a.top - b.bottom, b.top - a.bottom),
    );
    return { count: nodes.length, minGap: Math.min(...nodes.map((node) => gap(label, node))) };
  });
}

async function moveFirstLabelOutsideHorizontalRange(page, horizontalGapPx = 12) {
  return page.evaluate((gap) => {
    const svg = document.querySelector('svg');
    const label = document.querySelector('.cluster-label');
    if (!svg || !label) throw new Error('fixture 缺少 svg 或 cluster-label');
    const labelRect = label.getBoundingClientRect();
    const node = [...document.querySelectorAll('g.node')].find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return labelRect.left < rect.right && rect.left < labelRect.right;
    });
    if (!node) throw new Error('fixture 缺少横向候选节点');
    const nodeRect = node.getBoundingClientRect();
    const parent = label.parentNode;
    const toParent = (x, y) => {
      const point = svg.createSVGPoint();
      point.x = x;
      point.y = y;
      return point.matrixTransform(parent.getScreenCTM().inverse());
    };
    const dxScreen = nodeRect.left - gap - labelRect.right;
    const desiredBottom = nodeRect.top + Math.min(labelRect.height, nodeRect.height) / 2;
    const dyScreen = desiredBottom - labelRect.bottom;
    const before = toParent(labelRect.left, labelRect.top);
    const target = toParent(labelRect.left + dxScreen, labelRect.top + dyScreen);
    const existing = label.getAttribute('transform') || '';
    label.setAttribute('transform', (existing + ' translate(' + (target.x - before.x) + ',' + (target.y - before.y) + ')').trim());
    const movedLabel = label.getBoundingClientRect();
    const movedNode = node.getBoundingClientRect();
    return {
      transform: label.getAttribute('transform') || '',
      horizontalGap: movedNode.left - movedLabel.right,
      verticalOverlap: Math.min(movedLabel.bottom, movedNode.bottom) - Math.max(movedLabel.top, movedNode.top),
    };
  }, horizontalGapPx);
}

test.describe('子图标题防遮挡', () => {
  let fixtureUrl;

  test.beforeAll(() => {
    fixtureUrl = buildFixtureHtml();
  });

  test.afterAll(() => {
    rmSync(fixturePath, { force: true });
  });

  test('默认布局不进入降级状态', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    await page.evaluate(() => window.interactiveCodeMap.repairSubgraphTitles());
    await expect(page.locator('[data-icm-degraded]')).toHaveCount(0);
  });

  test('长 htmlLabels 标题不会超出 foreignObject 的可用尺寸', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    const metrics = await page.locator('.cluster-label foreignObject').evaluateAll((foreignObjects) => foreignObjects.map((foreignObject) => {
      const label = foreignObject.querySelector('div');
      if (!label) throw new Error('cluster-label 缺少 HTML 标题节点');
      return {
        availableWidth: foreignObject.width.baseVal.value,
        availableHeight: foreignObject.height.baseVal.value,
        requiredWidth: label.scrollWidth,
        requiredHeight: label.scrollHeight,
      };
    }));
    expect(metrics.length).toBeGreaterThan(0);
    for (const metric of metrics) {
      expect(metric.requiredWidth).toBeLessThanOrEqual(metric.availableWidth + 1);
      expect(metric.requiredHeight).toBeLessThanOrEqual(metric.availableHeight + 1);
    }
  });

  test('1-3px 的近距离会被推开至最小间距', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    await setFirstLabelVerticalGap(page, 2);
    const before = await candidateGapStatus(page);
    expect(before.minGap).toBeGreaterThanOrEqual(1);
    expect(before.minGap).toBeLessThan(4);
    await page.evaluate(() => window.interactiveCodeMap.repairSubgraphTitles());
    const after = await candidateGapStatus(page);
    expect(after.count).toBeGreaterThan(0);
    expect(after.minGap).toBeGreaterThanOrEqual(4);
  });

  test('边缘接触会被推开至最小间距', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    await setFirstLabelVerticalGap(page, 0);
    expect((await candidateGapStatus(page)).minGap).toBeLessThanOrEqual(0.1);
    await page.evaluate(() => window.interactiveCodeMap.repairSubgraphTitles());
    expect((await candidateGapStatus(page)).minGap).toBeGreaterThanOrEqual(4);
  });

  test('正面积重叠会提升标题并解除相交', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    await setFirstLabelVerticalGap(page, -12);
    await page.evaluate(() => window.interactiveCodeMap.repairSubgraphTitles());
    const noOverlap = await page.evaluate(() => {
      const label = document.querySelector('.cluster-label').getBoundingClientRect();
      return [...document.querySelectorAll('g.node')].every((node) => {
        const rect = node.getBoundingClientRect();
        const overlapX = Math.min(label.right, rect.right) - Math.max(label.left, rect.left);
        const overlapY = Math.min(label.bottom, rect.bottom) - Math.max(label.top, rect.top);
        return overlapX <= 0 || overlapY <= 0;
      });
    });
    expect(noOverlap).toBeTruthy();
  });

  test('任意手动偏移后会恢复为组内顶部居中页签', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    const before = await moveFirstLabelOutsideHorizontalRange(page);
    expect(before.horizontalGap).toBeGreaterThanOrEqual(8);
    expect(before.verticalOverlap).toBeGreaterThan(0);
    await page.evaluate(() => window.interactiveCodeMap.repairSubgraphTitles());
    const after = await page.evaluate(() => {
      const label = document.querySelector('.cluster-label');
      const title = label?.querySelector('foreignObject > div');
      const frame = label?.closest('g.cluster')?.querySelector(':scope > rect');
      if (!label || !title || !frame) throw new Error('fixture 缺少标题或分组边框');
      const titleRect = title.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      return {
        within: titleRect.left >= frameRect.left
          && titleRect.right <= frameRect.right
          && titleRect.top >= frameRect.top
          && titleRect.bottom <= frameRect.bottom,
        centerDelta: Math.abs(
          titleRect.left + titleRect.width / 2 - (frameRect.left + frameRect.width / 2),
        ),
        placement: label.getAttribute('data-icm-title-placement'),
      };
    });
    expect(after.within).toBeTruthy();
    expect(after.centerDelta).toBeLessThanOrEqual(1);
    expect(after.placement).toBe('top-tab');
  });

  test('重复修复不会继续累加位移', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    const first = await page.evaluate(() => {
      window.interactiveCodeMap.repairSubgraphTitles();
      return document.querySelector('.cluster-label')?.getAttribute('transform') || '';
    });
    const second = await page.evaluate(() => {
      window.interactiveCodeMap.repairSubgraphTitles();
      return document.querySelector('.cluster-label')?.getAttribute('transform') || '';
    });
    expect(second).toBe(first);
  });

  for (const scenario of [
    { name: 'desktop', viewport: { width: 1440, height: 900 } },
    { name: 'mobile', viewport: { width: 375, height: 667 } },
  ]) {
    test('长分组名称在 ' + scenario.name + ' 视口内保持包含、居中且不移动节点', async ({ page }) => {
      await page.setViewportSize(scenario.viewport);
      await loadFixture(page, fixtureUrl);
      const result = await page.evaluate(() => {
        const before = [...document.querySelectorAll('g.node')].map((el) => ({
          id: el.getAttribute('data-node-id'), x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y,
        }));
        const viewBoxBefore = document.querySelector('svg').getAttribute('viewBox');
        window.interactiveCodeMap.repairSubgraphTitles();
        const viewBoxAfter = document.querySelector('svg').getAttribute('viewBox');
        const after = [...document.querySelectorAll('g.node')].map((el) => ({
          id: el.getAttribute('data-node-id'), x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y,
        }));
        const titles = [...document.querySelectorAll('.cluster-label[data-subgraph]')].map((label) => {
          const title = label.querySelector('foreignObject > div');
          const frame = label.closest('g.cluster')?.querySelector(':scope > rect');
          if (!title || !frame) throw new Error('fixture 缺少标题或分组边框');
          const titleRect = title.getBoundingClientRect();
          const frameRect = frame.getBoundingClientRect();
          const name = label.getAttribute('data-subgraph');
          const firstNode = [...document.querySelectorAll('g.node[data-subgraph]')]
            .filter((node) => node.getAttribute('data-subgraph') === name)
            .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)[0];
          if (!firstNode) throw new Error('分组缺少首节点');
          return {
            within: titleRect.left >= frameRect.left
              && titleRect.right <= frameRect.right
              && titleRect.top >= frameRect.top
              && titleRect.bottom <= frameRect.bottom,
            centerDelta: Math.abs(titleRect.left + titleRect.width / 2 - (frameRect.left + frameRect.width / 2)),
            gapToFirstNode: firstNode.getBoundingClientRect().top - titleRect.bottom,
          };
        });
        return { before, after, viewBoxBefore, viewBoxAfter, titles };
      });
      expect(result.viewBoxAfter).toBe(result.viewBoxBefore);
      expect(result.titles.length).toBeGreaterThanOrEqual(2);
      expect(result.titles.every((title) => title.within && title.centerDelta <= 1
        && title.gapToFirstNode >= 12)).toBeTruthy();
      for (const before of result.before) {
        const after = result.after.find((entry) => entry.id === before.id);
        expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThanOrEqual(1);
      }
    });
  }

  test('产品 HTML 不含测试专用全局标记', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    expect(await page.content()).not.toContain('__TEST_');
  });
});
