import { test, expect } from './runtime-dependencies.fixture.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// 已提交的 sequence 双语 demo(同一示例源码的时序视图,真实产物非临时 fixture)。
// 交互与字面文本合同的全量回归在 sequence.spec.mjs;此处锁定 demo 产物自身的
// 渲染、自检、固定 UI 语言与代表性证据映射。
const englishUrl = pathToFileURL(path.resolve('examples/demo/expected-output.sequence.html')).href;
const chineseUrl = pathToFileURL(path.resolve('examples/demo/expected-output.sequence.zh-CN.html')).href;

test('英文时序 Demo 渲染、自检与 canonical 正确', async ({ page }) => {
  await page.goto(englishUrl);
  await expect(page.locator('#graph-canvas svg')).toBeVisible();
  await expect(page.locator('#fail-page')).toBeHidden();
  const state = await page.evaluate(() => ({
    kind: window.interactiveCodeMap.diagramKind,
    check: window.interactiveCodeMap.verifySequenceMapping(),
    foreignObject: document.querySelectorAll('svg foreignObject').length,
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    lang: document.documentElement.lang,
  }));
  expect(state.kind).toBe('sequence');
  expect(state.check.ok).toBe(true);
  expect(state.check.declaredMessageCount).toBe(25);
  expect(state.check.messageLineCount).toBe(25);
  expect(state.check.sequenceNumberCount).toBe(25);
  expect(state.foreignObject).toBe(0);
  expect(state.canonical).toBe('https://yulaiz.github.io/interactive-code-map/en/sequence/');
  expect(state.lang).toBe('en');
  await expect(page.locator('.icm-interaction-hint')).toContainText('Click a message or participant for details');
});

test('初始加载与点击 Fit 后参与者标题不与顶部控件重叠', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(englishUrl);
  await expect(page.locator('#graph-canvas svg')).toBeVisible();
  const readClearance = () => page.evaluate(() => {
    const controls = document.querySelector('.icm-controls').getBoundingClientRect();
    const actorTops = [...document.querySelectorAll('svg g[data-icm-participant-id]')]
      .map((group) => group.getBoundingClientRect().top);
    return { controlsBottom: controls.bottom, minActorTop: Math.min(...actorTops) };
  });
  // 初始 Fit:参与者顶框在顶部操作提示条下方,至少留 8px 净空。
  const initial = await readClearance();
  expect(initial.minActorTop).toBeGreaterThanOrEqual(initial.controlsBottom + 8);
  // 点击 Fit 后同样成立(共享同一 fitToScreen 路径)。
  await page.locator('.icm-toolbar button[aria-label="Fit to screen"]').click();
  await page.waitForTimeout(300);
  const afterFit = await readClearance();
  expect(afterFit.minActorTop).toBeGreaterThanOrEqual(afterFit.controlsBottom + 8);
});

test('初始阅读视图可读、起点可见且顶部避让,点击 Fit 后双向零相交', async ({ page }) => {
  // 1280 桌面与 827 窄窗口都要保证:可读倍率、调用起点不被裁出画布左缘。
  for (const viewport of [{ width: 1280, height: 800 }, { width: 827, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto(englishUrl);
    await expect(page.locator('#graph-canvas svg')).toBeVisible();
    const readState = () => page.evaluate(() => {
      const legend = document.querySelector('.icm-legend').getBoundingClientRect();
      const controls = document.querySelector('.icm-controls').getBoundingClientRect();
      const content = [...document.querySelectorAll(
        'svg g[data-icm-participant-id], svg .messageLine0, svg .messageLine1, svg text.messageText, svg text.sequenceNumber',
      )];
      const overlaps = (rect, frame) => Math.min(rect.right, frame.right) - Math.max(rect.left, frame.left) > 1
        && Math.min(rect.bottom, frame.bottom) - Math.max(rect.top, frame.top) > 1;
      const svg = document.querySelector('#graph-canvas svg');
      const firstActor = document.querySelector('svg g[data-icm-participant-id]');
      const firstText = document.querySelector('svg text.messageText');
      return {
        scale: window.interactiveCodeMap.panZoom.getState().scale,
        legendHits: content.filter((el) => overlaps(el.getBoundingClientRect(), legend)).length,
        controlsHits: content.filter((el) => overlaps(el.getBoundingClientRect(), controls)).length,
        controlsBottom: controls.bottom,
        minActorTop: Math.min(...[...document.querySelectorAll('svg g[data-icm-participant-id]')].map((g) => g.getBoundingClientRect().top)),
        firstActorLeft: firstActor.getBoundingClientRect().left,
        firstActorRight: firstActor.getBoundingClientRect().right,
        firstTextLeft: firstText.getBoundingClientRect().left,
        firstTextRight: firstText.getBoundingClientRect().right,
      };
    });
    // 初始为阅读视图:宽度适配带来可读倍率(16px 消息文字缩放后 ≥ 12px),
    // 内容顶对齐安全区;宽图从内容左边界开始,调用起点与第一条消息留在画布内;
    // 底部内容允许延伸到图例覆盖层之下,由平移/滚轮/全图按钮继续阅读。
    const initial = await readState();
    expect(initial.scale * 16).toBeGreaterThanOrEqual(12);
    expect(initial.controlsHits).toBe(0);
    expect(initial.minActorTop).toBeGreaterThanOrEqual(initial.controlsBottom + 8);
    expect(initial.firstActorLeft).toBeGreaterThanOrEqual(0);
    expect(initial.firstActorRight).toBeGreaterThan(initial.firstActorLeft);
    expect(initial.firstTextLeft).toBeGreaterThanOrEqual(0);
    expect(initial.firstTextRight).toBeGreaterThan(initial.firstTextLeft);
    // 点击 Fit 切换为全图概览:双向零相交(旧的高度公式会在此产生图例相交)。
    await page.locator('.icm-toolbar button[aria-label="Fit to screen"]').click();
    await page.waitForTimeout(300);
    const afterFit = await readState();
    expect(afterFit.legendHits).toBe(0);
    expect(afterFit.controlsHits).toBe(0);
  }
});

test('英文时序 Demo 点击 verified/inferred/unconfirmed 消息打开对应证据', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(englishUrl);
  await expect(page.locator('#graph-canvas svg')).toBeVisible();
  // 跨区域点击前先点 Fit 把全图收进视口:前次选择会平移画布聚焦消息,远处的
  // 下一条目标可能留在视口外(真实鼠标点击会因 element outside viewport 超时)。
  const clickMessage = async (text) => {
    await page.locator('.icm-toolbar button[aria-label="Fit to screen"]').click();
    await page.waitForTimeout(250);
    await page.locator('svg text.messageText', { hasText: text }).first().click();
  };
  await clickMessage('chargeCard with amountCents');
  await expect(page.locator('#detail-panel h2')).toHaveText('#5 Order service → Payment gateway: chargeCard with amountCents');
  await expect(page.locator('#detail-panel .claim-state')).toHaveText('verified');
  await expect(page.locator('#detail-panel .evidence .ev-path').first()).toHaveText('order-service.js');
  await expect(page.locator('#detail-panel .icm-segment')).toContainText('Guard contract');
  // 异步履约段:履约队列参与者与 inferred 的规划接线共存。
  await page.keyboard.press('Escape');
  await clickMessage('enqueueFulfillment');
  await expect(page.locator('#detail-panel .claim-state')).toHaveText('inferred');
  await page.keyboard.press('Escape');
  await clickMessage('send toPlainText export');
  await expect(page.locator('#detail-panel .claim-state')).toHaveText('unconfirmed');
});

test('中文时序 Demo 使用中文固定 UI 与状态点', async ({ page }) => {
  await page.goto(chineseUrl);
  await expect(page.locator('#graph-canvas svg')).toBeVisible();
  await expect(page.locator('svg')).toHaveAttribute('data-icm-ui-locale', 'zh-CN');
  await expect(page.locator('.icm-legend')).toContainText('参与者');
  await expect(page.locator('.icm-legend')).toContainText('消息');
  await expect(page.locator('.icm-legend')).toContainText('帧（循环/条件/分支）');
  await page.locator('svg g[data-icm-participant-id="counter"]').click();
  await expect(page.locator('#detail-panel h2')).toHaveText('柜台调用方');
  await expect(page.locator('#detail-panel .claim-state')).toHaveText('推断');
  await page.keyboard.press('Escape');
  const dot = page.locator('svg g[data-icm-participant-id="counter"] .icm-sequence-state-dot');
  await expect(dot).toHaveAttribute('data-claim-state', 'inferred');
  await expect(dot.locator('title')).toHaveText('推断');
  await page.locator('svg text.messageText', { hasText: '发送 toPlainText 导出' }).first().click();
  await expect(page.locator('#detail-panel .claim-state')).toHaveText('待确认');
});
