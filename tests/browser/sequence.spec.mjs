import { test, expect } from './runtime-dependencies.fixture.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const fixtureRelative = 'tests/browser/fixtures/.tmp-sequence.html';
const zhFixtureRelative = 'tests/browser/fixtures/.tmp-sequence-zh.html';
const fixturePath = path.resolve(fixtureRelative);
const zhFixturePath = path.resolve(zhFixtureRelative);
const fixtureInput = path.resolve('tests/browser/fixtures/sequence-payment-flow.mapspec.json');
const builder = path.resolve('skill/renderer/build-html.mjs');

// fixture 的自消息是字面文本合同的总闸向量:9 个受控字符、wrap: 控制前缀、
// $$…$$ 数学路径、字面 <br/> 与普通百分比全部原样出现在一条消息里。
const LITERAL_LABEL = 'Wrap: retry $$x$$ <br/> 50% a & b ; c # d " e < f > g';
const DECLARED_MESSAGE_COUNT = 9;

function buildFixtureHtml(outputRelative, inputPath) {
  execFileSync('node', [
    builder,
    '--in', inputPath,
    '--out', outputRelative,
    '--repo-root', process.cwd(),
    '--allow-test-fixture',
  ], { stdio: 'pipe' });
}

function buildZhVariant() {
  const spec = JSON.parse(readFileSync(fixtureInput, 'utf8'));
  spec.meta.uiLocale = 'zh-CN';
  spec.meta.title = '支付回调重试时序(fixture)';
  const zhInput = path.resolve('tests/browser/fixtures/.tmp-sequence-zh.mapspec.json');
  writeFileSync(zhInput, JSON.stringify(spec));
  try {
    buildFixtureHtml(zhFixtureRelative, zhInput);
  } finally {
    rmSync(zhInput, { force: true });
  }
}

async function loadFixture(page, fixtureUrl) {
  await page.goto(fixtureUrl);
  await expect(page.locator('#graph-canvas svg')).toBeVisible();
  await expect(page.locator('#fail-page')).toBeHidden();
}

test.describe('sequence 时序图渲染链', () => {
  let fixtureUrl;
  let zhFixtureUrl;

  test.beforeAll(() => {
    buildFixtureHtml(fixtureRelative, fixtureInput);
    buildZhVariant();
    fixtureUrl = pathToFileURL(fixturePath).href;
    zhFixtureUrl = pathToFileURL(zhFixturePath).href;
  });

  test.afterAll(() => {
    rmSync(fixturePath, { force: true });
    rmSync(zhFixturePath, { force: true });
  });

  test('diagramKind 标记与自检 API:消息线/序号计数与声明一致', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    const state = await page.evaluate(() => ({
      kind: window.interactiveCodeMap.diagramKind,
      check: window.interactiveCodeMap.verifySequenceMapping(),
    }));
    expect(state.kind).toBe('sequence');
    expect(state.check.declaredMessageCount).toBe(DECLARED_MESSAGE_COUNT);
    expect(state.check.messageLineCount).toBe(DECLARED_MESSAGE_COUNT);
    expect(state.check.sequenceNumberCount).toBe(DECLARED_MESSAGE_COUNT);
    expect(state.check.ok).toBe(true);
  });

  test('全产物 foreignObject 数为 0 且 autonumber 序号齐全', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    const counts = await page.evaluate(() => ({
      foreignObject: document.querySelectorAll('svg foreignObject').length,
      sequenceNumber: document.querySelectorAll('svg text.sequenceNumber').length,
      messageLines: document.querySelectorAll('svg .messageLine0, svg .messageLine1').length,
    }));
    expect(counts.foreignObject).toBe(0);
    expect(counts.sequenceNumber).toBe(DECLARED_MESSAGE_COUNT);
    expect(counts.messageLines).toBe(DECLARED_MESSAGE_COUNT);
  });

  test('字面文本合同总闸:9 字符、wrap:、$$…$$、字面 br、百分比全部原文可见', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    const texts = await page.evaluate(() => [...document.querySelectorAll('svg text.messageText')].map((el) => el.textContent));
    expect(texts).toContain(LITERAL_LABEL);
    // 帧条件纯文本(长英文单词,窄帧 wrap 后)不得出现实体残片
    const frameTexts = await page.evaluate(() => ({
      loop: [...document.querySelectorAll('svg text.loopText')].map((el) => el.textContent),
      section: [...document.querySelectorAll('svg text.sectionTitle')].map((el) => el.textContent),
    }));
    expect(frameTexts.loop.join('\n')).toContain('[IdempotencyWindowCallbackRetryBudgetExhaustionThresholdCheck]');
    expect(frameTexts.section.join('\n')).toContain('Retry limit reached');
    const joined = frameTexts.loop.join('') + frameTexts.section.join('');
    expect(joined).not.toContain('&#');
    expect(joined).not.toContain('#35;');
    expect(joined).not.toContain('#38;');
  });

  test('真实点击消息文本打开正确的证据详情(含编号标题)', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    const messageText = page.locator('svg text.messageText', { hasText: 'Create payment intent' }).first();
    await messageText.click();
    await expect(page.locator('#detail-panel')).toBeVisible();
    await expect(page.locator('#detail-panel h2')).toHaveText('#1 Client app → Payment gateway: Create payment intent');
    await expect(page.locator('#detail-panel .claim-state')).toHaveText('verified');
    await expect(page.locator('#detail-panel .evidence .ev-path').first()).toHaveText('tests/browser/fixtures/sequence-fixture-evidence.txt');
  });

  test('真实点击消息线打开所属消息详情', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    // 消息线是 SVG line;真实 click 必须穿过 panzoom 的指针捕获(命中判断注入)。
    await page.locator('svg .messageLine0, svg .messageLine1').first().click({ force: true });
    await expect(page.locator('#detail-panel h2')).toHaveText('#1 Client app → Payment gateway: Create payment intent');
  });

  test('真实点击参与者打开参与者详情', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    const participant = page.locator('svg g[data-icm-participant-id="client"]');
    await participant.click();
    await expect(page.locator('#detail-panel h2')).toHaveText('Client app');
    await expect(page.locator('#detail-panel .icm-summary')).toContainText('client starts the payment');
  });

  test('detail 缺省的面板只展示标题、状态与证据', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    await page.locator('svg g[data-icm-participant-id="alt"]').click();
    await expect(page.locator('#detail-panel h2')).toHaveText('Audit log');
    await expect(page.locator('#detail-panel .claim-state')).toHaveText('unconfirmed');
    await expect(page.locator('#detail-panel .icm-summary')).toHaveCount(0);
    await expect(page.locator('#detail-panel .icm-segment')).toHaveCount(0);
    await expect(page.locator('#detail-panel .icm-empty')).toHaveCount(0);
    await expect(page.locator('#detail-panel .evidence')).toBeVisible();
  });

  test('选中反馈:点击后文本/线/序号高亮,单选中,关闭或 Esc 清除', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    const firstText = page.locator('svg text.messageText', { hasText: 'Create payment intent' }).first();
    await firstText.click();
    const selectedKeys = await page.evaluate(() => ({
      highlighted: [...document.querySelectorAll('svg .icm-sequence-selected')].map((el) => el.getAttribute('data-icm-focus-id')),
      unique: new Set([...document.querySelectorAll('svg .icm-sequence-selected')].map((el) => el.getAttribute('data-icm-focus-id'))).size,
    }));
    expect(selectedKeys.unique).toBe(1);
    expect(selectedKeys.highlighted.length).toBeGreaterThanOrEqual(2);
    expect(selectedKeys.highlighted.every((key) => key === 'message:1')).toBe(true);

    // 单选中:改选另一条消息后,前一条清除。Emit audit event 是顶层第 6 个
    // 元素,选择键为路径制 message:6;详情标题 #9 为全局执行序(与 autonumber 一致)。
    await page.locator('svg text.messageText', { hasText: 'Emit audit event' }).click();
    await expect(page.locator('#detail-panel h2')).toHaveText('#9 Payment gateway → Audit log: Emit audit event');
    const nextSelection = await page.evaluate(() => [...document.querySelectorAll('svg .icm-sequence-selected')].map((el) => el.getAttribute('data-icm-focus-id')));
    expect(nextSelection.length).toBeGreaterThanOrEqual(2);
    expect(nextSelection.every((key) => key === 'message:6')).toBe(true);

    // Esc 清除(面板关闭 + 高亮消失)。
    await page.keyboard.press('Escape');
    await expect(page.locator('#detail-panel')).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelectorAll('svg .icm-sequence-selected').length)).toBe(0);

    // 关闭按钮同样清除。
    await page.locator('svg text.messageText', { hasText: 'Create payment intent' }).first().click();
    await page.locator('#detail-panel button[aria-label="Close detail"]').click();
    await expect(page.locator('#detail-panel')).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelectorAll('svg .icm-sequence-selected').length)).toBe(0);
  });

  test('同一端点多条消息各自打开自己的详情,嵌套帧内消息不串用', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    const cases = [
      { text: 'Post ledger entry', title: '#2 Payment gateway → Ledger service: Post ledger entry' },
      { text: 'Confirm posting', title: '#3 Payment gateway → Ledger service: Confirm posting' },
      { text: 'Return posting receipt', title: '#4 Ledger service → Payment gateway: Return posting receipt' },
      { text: 'Issue retry', title: '#5 Payment gateway → Ledger service: Issue retry' },
    ];
    for (const item of cases) {
      await page.locator('svg text.messageText', { hasText: item.text }).first().click();
      await expect(page.locator('#detail-panel h2')).toHaveText(item.title);
      await page.keyboard.press('Escape');
      await expect(page.locator('#detail-panel')).toHaveCount(0);
    }
  });

  test('空白拖动平移与滚轮缩放正常', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    const before = await page.evaluate(() => window.interactiveCodeMap.panZoom.getState());
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(380, 360, { steps: 5 });
    await page.mouse.up();
    const afterPan = await page.evaluate(() => window.interactiveCodeMap.panZoom.getState());
    expect(Math.abs(afterPan.tx - before.tx)).toBeGreaterThan(20);
    expect(Math.abs(afterPan.ty - before.ty)).toBeGreaterThan(20);
    await page.mouse.move(400, 300);
    await page.mouse.wheel(0, -240);
    const afterZoom = await page.evaluate(() => window.interactiveCodeMap.panZoom.getState());
    expect(afterZoom.scale).toBeGreaterThan(afterPan.scale);
  });

  test('外层激活包住整帧:activation 条渲染正确', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    const activations = await page.evaluate(() => document.querySelectorAll('svg [class*="activation"]').length);
    expect(activations).toBeGreaterThanOrEqual(1);
  });

  test('三态状态点与图例一致', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    const dots = await page.evaluate(() => ({
      verified: document.querySelectorAll('svg .icm-sequence-state-dot.icm-node-evidence-verified').length,
      inferred: document.querySelectorAll('svg .icm-sequence-state-dot.icm-node-evidence-inferred').length,
      unconfirmed: document.querySelectorAll('svg .icm-sequence-state-dot.icm-node-evidence-unconfirmed').length,
      legendVerified: getComputedStyle(document.querySelector('.icm-legend .claim-state.verified')).color,
      dotVerifiedFill: getComputedStyle(document.querySelector('svg .icm-sequence-state-dot.icm-node-evidence-verified')).fill,
    }));
    // 4 参与者 + 9 消息 = 13 个状态点;verified=2 参与者 + 4 消息。
    expect(dots.verified + dots.inferred + dots.unconfirmed).toBe(13);
    expect(dots.verified).toBe(6);
    expect(dots.inferred).toBe(4);
    expect(dots.unconfirmed).toBe(3);
    // 图例与状态点使用同一色板(字符串化颜色一致)。
    expect(dots.dotVerifiedFill).toBe(dots.legendVerified);
  });

  test('英文固定 UI:工具栏提示与图例按 sequence 语境展示', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    await expect(page.locator('.icm-interaction-hint')).toContainText('Click a message or participant for details');
    await expect(page.locator('.icm-legend')).toContainText('Participant');
    await expect(page.locator('.icm-legend')).toContainText('Message');
    await expect(page.locator('.icm-legend')).toContainText('Frame (loop/condition/branch)');
    // 时序图不出现关系线钉住操作说明。
    await expect(page.locator('.icm-legend')).not.toContainText('Click a line to pin it');
  });

  test('中文固定 UI:zh-CN 变体的提示与图例本地化', async ({ page }) => {
    await loadFixture(page, zhFixtureUrl);
    await expect(page.locator('.icm-interaction-hint')).toContainText('点击消息或参与者查看详情');
    await expect(page.locator('.icm-legend')).toContainText('参与者');
    await expect(page.locator('.icm-legend')).toContainText('消息');
    await expect(page.locator('.icm-legend')).toContainText('帧（循环/条件/分支）');
    expect(await page.evaluate(() => window.interactiveCodeMap.verifySequenceMapping().ok)).toBe(true);
  });

  test('消息记录的 key 唯一且与声明一一对应', async ({ page }) => {
    await loadFixture(page, fixtureUrl);
    const keys = await page.evaluate(() => ({
      lineKeys: [...document.querySelectorAll('svg .messageLine0, svg .messageLine1')].map((el) => el.getAttribute('data-icm-message-key')),
      focusIds: [...document.querySelectorAll('svg [data-icm-focus-id^="message:"]')].map((el) => el.getAttribute('data-icm-focus-id')),
    }));
    expect(new Set(keys.lineKeys).size).toBe(DECLARED_MESSAGE_COUNT);
    // 每条消息的文本/线/序号共享同一个 focus id(选中反馈的统一标记)。
    expect(keys.focusIds.filter((key) => key === 'message:1').length).toBeGreaterThanOrEqual(3);
  });
});

// ---------- Fit 安全区几何反例(右下消息 fixture) ----------
// 该 fixture 的最后一条消息位于画布右下(最右两条生命线之间),专门覆盖
// 「Fit 安全区同时收缩顶部与底部」的布局。若图例高度计算漏减顶部 inset
// (旧公式 legendTop - 12),内容底部会向下多延伸一个顶部 inset,最后一条
// 消息将落入图例区域——本测试必须在该旧公式下失败。
test.describe('sequence Fit 安全区反例(右下消息)', () => {
  const geomRelative = 'tests/browser/fixtures/.tmp-sequence-geometry.html';
  const geomPath = path.resolve(geomRelative);
  const geomInput = path.resolve('tests/browser/fixtures/sequence-fit-geometry.mapspec.json');
  let geomUrl;

  test.beforeAll(() => {
    buildFixtureHtml(geomRelative, geomInput);
    geomUrl = pathToFileURL(geomPath).href;
  });

  test.afterAll(() => {
    rmSync(geomPath, { force: true });
  });

  test('初始阅读视图顶部避让,点击 Fit 后右下消息不与控件和图例相交', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loadFixture(page, geomUrl);
    const readOverlaps = () => page.evaluate(() => {
      const legend = document.querySelector('.icm-legend').getBoundingClientRect();
      const controls = document.querySelector('.icm-controls').getBoundingClientRect();
      const content = [...document.querySelectorAll(
        'svg g[data-icm-participant-id], svg .messageLine0, svg .messageLine1, svg text.messageText, svg text.sequenceNumber',
      )];
      const overlaps = (rect, frame) => Math.min(rect.right, frame.right) - Math.max(rect.left, frame.left) > 1
        && Math.min(rect.bottom, frame.bottom) - Math.max(rect.top, frame.top) > 1;
      return {
        legendHits: content.filter((el) => overlaps(el.getBoundingClientRect(), legend)).length,
        controlsHits: content.filter((el) => overlaps(el.getBoundingClientRect(), controls)).length,
        lastMessageBottom: Math.max(...[...document.querySelectorAll('svg text.messageText')].map((el) => el.getBoundingClientRect().bottom)),
        legendTop: legend.top,
      };
    });
    // 初始阅读视图:顶部不压控件(底部内容延伸到图例覆盖层之下是设计行为)。
    const initial = await readOverlaps();
    expect(initial.controlsHits).toBe(0);
    // 点击 Fit 全图概览:右下消息必须完整避开图例——旧的高度公式
    // (legendTop - 12,漏减顶部 inset)会在此产生 4 处图例相交,本测试必失败。
    await page.locator('.icm-toolbar button[aria-label="Fit to screen"]').click();
    await page.waitForTimeout(300);
    const afterFit = await readOverlaps();
    expect(afterFit.controlsHits).toBe(0);
    expect(afterFit.legendHits).toBe(0);
    expect(afterFit.lastMessageBottom).toBeLessThan(afterFit.legendTop);
  });
});

// ---------- 阅读视图横向起点(12 参与者宽图 fixture) ----------
// 合同允许的 12 参与者上限图在可读倍率下必然宽于视口;readView 若按整图居中,
// 调用起点与第一条消息会被裁出画布左缘。回归断言初始视图从内容左边界开始:
// 第一个参与者与第一条消息都在画布内,且保持可读倍率与顶部避让。
test.describe('sequence 阅读视图横向起点(12 参与者宽图)', () => {
  const wideRelative = 'tests/browser/fixtures/.tmp-sequence-wide.html';
  const widePath = path.resolve(wideRelative);
  const wideInput = path.resolve('tests/browser/fixtures/sequence-read-origin.mapspec.json');
  let wideUrl;

  test.beforeAll(() => {
    buildFixtureHtml(wideRelative, wideInput);
    wideUrl = pathToFileURL(widePath).href;
  });

  test.afterAll(() => {
    rmSync(widePath, { force: true });
  });

  test('宽图首屏从调用起点开始:首参与者与首消息在画布内且可读', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loadFixture(page, wideUrl);
    const state = await page.evaluate(() => {
      const controls = document.querySelector('.icm-controls').getBoundingClientRect();
      const actors = [...document.querySelectorAll('svg g[data-icm-participant-id]')];
      const firstText = document.querySelector('svg text.messageText');
      return {
        scale: window.interactiveCodeMap.panZoom.getState().scale,
        screenFontPx: 16 * window.interactiveCodeMap.panZoom.getState().scale,
        firstActorLeft: Math.min(...actors.map((g) => g.getBoundingClientRect().left)),
        firstActorTop: Math.min(...actors.map((g) => g.getBoundingClientRect().top)),
        controlsBottom: controls.bottom,
        firstTextLeft: firstText.getBoundingClientRect().left,
        firstTextRight: firstText.getBoundingClientRect().right,
        firstText: firstText.textContent,
      };
    });
    expect(state.screenFontPx).toBeGreaterThanOrEqual(12);
    expect(state.firstActorLeft).toBeGreaterThanOrEqual(0);
    expect(state.firstActorTop).toBeGreaterThanOrEqual(state.controlsBottom + 8);
    expect(state.firstTextLeft).toBeGreaterThanOrEqual(0);
    expect(state.firstTextRight).toBeGreaterThan(state.firstTextLeft);
    expect(state.firstText).toBe('Wide step 1');
  });
});

// ---------- Fit 缩放下限(高图 fixture) ----------
// 8 参与者、60 条消息、30 个顺序 opt 帧:布局远高于视口,全图适配倍率由
// 「扣除顶部控件与底部图例后的高度」决定。下限若按完整视口高度计算会被
// 抬高,Fit 后底部消息仍被图例盖住——回归断言 Fit 后与两个覆盖层零相交。
test.describe('sequence Fit 缩放下限(高图)', () => {
  const tallRelative = 'tests/browser/fixtures/.tmp-sequence-tall.html';
  const tallPath = path.resolve(tallRelative);
  const tallInput = path.resolve('tests/browser/fixtures/sequence-fit-tall.mapspec.json');
  let tallUrl;

  test.beforeAll(() => {
    buildFixtureHtml(tallRelative, tallInput);
    tallUrl = pathToFileURL(tallPath).href;
  });

  test.afterAll(() => {
    rmSync(tallPath, { force: true });
  });

  test('点击 Fit 后高图完整落入控件与图例之间的安全带', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loadFixture(page, tallUrl);
    const readOverlaps = () => page.evaluate(() => {
      const legend = document.querySelector('.icm-legend').getBoundingClientRect();
      const controls = document.querySelector('.icm-controls').getBoundingClientRect();
      const content = [...document.querySelectorAll(
        'svg g[data-icm-participant-id], svg .messageLine0, svg .messageLine1, svg text.messageText, svg text.sequenceNumber',
      )];
      const overlaps = (rect, frame) => Math.min(rect.right, frame.right) - Math.max(rect.left, frame.left) > 1
        && Math.min(rect.bottom, frame.bottom) - Math.max(rect.top, frame.top) > 1;
      return {
        legendHits: content.filter((el) => overlaps(el.getBoundingClientRect(), legend)).length,
        controlsHits: content.filter((el) => overlaps(el.getBoundingClientRect(), controls)).length,
        scale: window.interactiveCodeMap.panZoom.getState().scale,
      };
    });
    await page.locator('.icm-toolbar button[aria-label="Fit to screen"]').click();
    await page.waitForTimeout(300);
    const afterFit = await readOverlaps();
    expect(afterFit.controlsHits).toBe(0);
    expect(afterFit.legendHits).toBe(0);
    // 高图的适配倍率由可见区高度决定,必然低于旧的完整视口口径下限。
    expect(afterFit.scale).toBeLessThan(0.15);
  });
});

// ---------- Fit 缩放下限(长标题宽图 fixture) ----------
// 合同允许 12 参与者配 93 码点标题,全图适配倍率远低于旧的 0.15 缩放下限。
// 动态下限修复前,Fit 与缩小都停在半程,最右参与者落在视口之外;回归断言
// 点击 Fit 后所有参与者与消息横向完整落入视口。
test.describe('sequence Fit 缩放下限(长标题宽图)', () => {
  const boundRelative = 'tests/browser/fixtures/.tmp-sequence-lower-bound.html';
  const boundPath = path.resolve(boundRelative);
  const boundInput = path.resolve('tests/browser/fixtures/sequence-fit-lower-bound.mapspec.json');
  let boundUrl;

  test.beforeAll(() => {
    buildFixtureHtml(boundRelative, boundInput);
    boundUrl = pathToFileURL(boundPath).href;
  });

  test.afterAll(() => {
    rmSync(boundPath, { force: true });
  });

  test('点击 Fit 后全图横向落入视口,缩小可突破旧 0.15 下限', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loadFixture(page, boundUrl);
    const measure = () => page.evaluate(() => {
      const viewportWidth = document.getElementById('graph-viewport').clientWidth;
      const actors = [...document.querySelectorAll('svg g[data-icm-participant-id]')].map((g) => g.getBoundingClientRect());
      const texts = [...document.querySelectorAll('svg text.messageText')].map((el) => el.getBoundingClientRect());
      return {
        viewportWidth,
        maxRight: Math.max(...actors.concat(texts).map((r) => r.right)),
        minLeft: Math.min(...actors.map((r) => r.left)),
        state: window.interactiveCodeMap.panZoom.getState(),
      };
    });
    // 初始阅读视图(0.75)下宽图必然横向溢出——这正是该 fixture 的形态前提。
    const initial = await measure();
    expect(initial.maxRight).toBeGreaterThan(initial.viewportWidth);
    // 点击 Fit:动态下限必须让适配倍率真正达成,全图横向落入视口。
    await page.locator('.icm-toolbar button[aria-label="Fit to screen"]').click();
    await page.waitForTimeout(300);
    const afterFit = await measure();
    expect(afterFit.state.scale).toBeLessThan(0.15);
    expect(afterFit.maxRight).toBeLessThanOrEqual(afterFit.viewportWidth);
    expect(afterFit.minLeft).toBeGreaterThanOrEqual(0);
    // 缩小按钮可继续突破旧下限(不早于 Fit 倍率卡住)。
    await page.locator('.icm-toolbar button[aria-label="Zoom out"]').click();
    await page.waitForTimeout(200);
    const afterZoomOut = await page.evaluate(() => window.interactiveCodeMap.panZoom.getState().scale);
    expect(afterZoomOut).toBeLessThan(afterFit.state.scale);
  });
});

// ---------- 字面文本合同的参数化回归(消息与参与者别名双上下文) ----------
// 这些向量在 Node 单测中只有 DSL 字符串断言;此处经完整 build→render 管线,
// 以「结构数量 + 原文完整可见 + foreignObject=0」三向断言固化浏览器行为。
const LITERAL_VECTORS = [
  // % 指令删除:被 Mermaid 预处理删除时前后缀仍在、计数不变,只有原文断言能抓住。
  { title: '%%{init}%% directive', label: 'prefix %%{init}%% suffix' },
  // 实体形态输入:单遍历编码不得对自身输出的 # 与 ; 二次转义。
  { title: '&#38; entity form', label: '&#38; literal entity' },
  // wrap:/nowrap: 控制前缀:被语法消费时只显示后半段。
  { title: 'wrap: retry nowrap: ok', label: 'wrap: retry nowrap: ok' },
  // $$…$$ 数学渲染路径(产生 foreignObject)+ 字面 <br/> + 百分比。
  { title: '$$x$$ <br/> 50%', label: 'a & b ; c # d " e < f > g : h % i $ j' },
  { title: 'Gate', label: '完成率 50%' },
];

test.describe('sequence 字面文本向量(消息与参与者别名上下文)', () => {
  const vectorRelative = 'tests/browser/fixtures/.tmp-sequence-vectors.html';
  const vectorPath = path.resolve(vectorRelative);
  let vectorUrl;

  test.beforeAll(() => {
    const participants = LITERAL_VECTORS.map((vector, index) => ({
      id: 'p' + (index + 1),
      title: vector.title,
      claimState: 'verified',
      evidence: [{ path: 'tests/browser/fixtures/sequence-fixture-evidence.txt', lineStart: 1, lineEnd: 2, state: 'verified' }],
    }));
    const messages = LITERAL_VECTORS.map((vector, index) => ({
      from: 'p' + (index + 1),
      to: 'p1',
      label: vector.label,
      claimState: 'verified',
      evidence: [{ path: 'tests/browser/fixtures/sequence-fixture-evidence.txt', lineStart: 1, lineEnd: 2, state: 'verified' }],
    }));
    const spec = JSON.parse(readFileSync(fixtureInput, 'utf8'));
    spec.participants = participants;
    spec.messages = messages;
    const inputPath = path.resolve('tests/browser/fixtures/.tmp-sequence-vectors.mapspec.json');
    writeFileSync(inputPath, JSON.stringify(spec));
    try {
      buildFixtureHtml(vectorRelative, inputPath);
    } finally {
      rmSync(inputPath, { force: true });
    }
    vectorUrl = pathToFileURL(vectorPath).href;
  });

  test.afterAll(() => {
    rmSync(vectorPath, { force: true });
  });

  test('参与者别名与消息文本原文完整可见,结构计数与 foreignObject 合同成立', async ({ page }) => {
    await page.goto(vectorUrl);
    await expect(page.locator('#graph-canvas svg')).toBeVisible();
    const result = await page.evaluate(() => ({
      actorTexts: [...document.querySelectorAll('svg text.actor')].map((el) => el.textContent),
      messageTexts: [...document.querySelectorAll('svg text.messageText')].map((el) => el.textContent),
      messageLines: document.querySelectorAll('svg .messageLine0, svg .messageLine1').length,
      sequenceNumbers: document.querySelectorAll('svg text.sequenceNumber').length,
      foreignObject: document.querySelectorAll('svg foreignObject').length,
    }));
    expect(result.messageLines).toBe(LITERAL_VECTORS.length);
    expect(result.sequenceNumbers).toBe(LITERAL_VECTORS.length);
    expect(result.foreignObject).toBe(0);
    const actorJoined = result.actorTexts.join('\n---\n');
    for (const vector of LITERAL_VECTORS) {
      expect(result.messageTexts, `消息原文应含 ${JSON.stringify(vector.label)}`).toContain(vector.label);
      expect(actorJoined, `参与者别名原文应含 ${JSON.stringify(vector.title)}`).toContain(vector.title);
    }
  });
});

// ---------- 窄帧断行回归(四种帧上下文 × 确实断行的长条件) ----------
// 帧条件走纯文本直出;窄帧自动换行时原文必须完整、不得出现实体残片。
// 断言用字母数字序列比较:断行可能插入视觉连字符与括号,但不得丢失任何原字符。
const NARROW_FRAME_CONDITIONS = [
  { selector: 'loopText', word: 'NarrowFrameLoopWrapBreakingLongConditionWordABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' },
  { selector: 'loopText', word: 'NarrowFrameOptWrapBreakingLongConditionWordBCDEFGHIJKLMNOPQRSTUVWXYZA0123456789' },
  { selector: 'loopText', word: 'NarrowFrameAltFirstBranchWrapBreakingLongConditionWordCDEFGHIJKLMNOPQRSTUVWXYZAB0123456789' },
  { selector: 'sectionTitle', word: 'NarrowFrameAltElseWrapBreakingLongConditionWordDEFGHIJKLMNOPQRSTUVWXYZABC0123456789' },
];

test.describe('sequence 窄帧断行(loop/opt/alt 首分支/else)', () => {
  const narrowRelative = 'tests/browser/fixtures/.tmp-sequence-narrow.html';
  const narrowPath = path.resolve(narrowRelative);
  let narrowUrl;

  test.beforeAll(() => {
    const spec = JSON.parse(readFileSync(fixtureInput, 'utf8'));
    spec.participants = [
      { id: 'near1', title: 'Near A', claimState: 'verified', evidence: [{ path: 'tests/browser/fixtures/sequence-fixture-evidence.txt', lineStart: 1, lineEnd: 2, state: 'verified' }] },
      { id: 'near2', title: 'Near B', claimState: 'verified', evidence: [{ path: 'tests/browser/fixtures/sequence-fixture-evidence.txt', lineStart: 1, lineEnd: 2, state: 'verified' }] },
    ];
    const message = (label) => ({
      from: 'near1', to: 'near2', label, claimState: 'verified',
      evidence: [{ path: 'tests/browser/fixtures/sequence-fixture-evidence.txt', lineStart: 1, lineEnd: 2, state: 'verified' }],
    });
    spec.messages = [
      { frame: true, kind: 'loop', label: NARROW_FRAME_CONDITIONS[0].word, messages: [message('loop tick')] },
      { frame: true, kind: 'opt', label: NARROW_FRAME_CONDITIONS[1].word, messages: [message('opt tick')] },
      {
        frame: true,
        kind: 'alt',
        branches: [
          { label: NARROW_FRAME_CONDITIONS[2].word, messages: [message('alt first')] },
          { label: NARROW_FRAME_CONDITIONS[3].word, messages: [message('alt else')] },
        ],
      },
    ];
    const inputPath = path.resolve('tests/browser/fixtures/.tmp-sequence-narrow.mapspec.json');
    writeFileSync(inputPath, JSON.stringify(spec));
    try {
      buildFixtureHtml(narrowRelative, inputPath);
    } finally {
      rmSync(inputPath, { force: true });
    }
    narrowUrl = pathToFileURL(narrowPath).href;
  });

  test.afterAll(() => {
    rmSync(narrowPath, { force: true });
  });

  test('四种帧条件断行后原文完整、无实体残片,结构计数正确', async ({ page }) => {
    await page.goto(narrowUrl);
    await expect(page.locator('#graph-canvas svg')).toBeVisible();
    const result = await page.evaluate(() => ({
      loopTexts: [...document.querySelectorAll('svg text.loopText')].map((el) => ({
        text: el.textContent,
        tspans: el.querySelectorAll('tspan').length,
      })),
      sectionTitles: [...document.querySelectorAll('svg text.sectionTitle')].map((el) => ({
        text: el.textContent,
        tspans: el.querySelectorAll('tspan').length,
      })),
      messageLines: document.querySelectorAll('svg .messageLine0, svg .messageLine1').length,
      sequenceNumbers: document.querySelectorAll('svg text.sequenceNumber').length,
      foreignObject: document.querySelectorAll('svg foreignObject').length,
    }));
    expect(result.messageLines).toBe(4);
    expect(result.sequenceNumbers).toBe(4);
    expect(result.foreignObject).toBe(0);

    const alnum = (text) => (text || '').replace(/[^A-Za-z0-9]/g, '');
    for (const condition of NARROW_FRAME_CONDITIONS) {
      const pool = condition.selector === 'loopText' ? result.loopTexts : result.sectionTitles;
      const rendered = pool.map((entry) => entry.text).join('\n');
      expect(
        alnum(rendered),
        `帧条件 ${condition.word} 断行后字母数字序列完整`,
      ).toContain(alnum(condition.word));
    }

    // 实体残片:编码实体被窄帧换行拆坏时会暴露 &#/#NN; 形态残迹。
    const allFrameText = result.loopTexts.concat(result.sectionTitles).map((entry) => entry.text).join('\n');
    expect(allFrameText).not.toContain('&#');
    for (const entity of ['#35;', '#38;', '#59;', '#34;', '#60;', '#62;', '#36;', '#58;', '#37;']) {
      expect(allFrameText, `帧条件不得出现实体残片 ${entity}`).not.toContain(entity);
    }

    // 长条件确实发生断行:至少一个帧条件被拆成多个 tspan(断言覆盖了"可断行"
    // 这一前提,而不是只在不断行的舒适布局下碰巧通过)。
    const tspanTotal = result.loopTexts.concat(result.sectionTitles)
      .reduce((sum, entry) => sum + entry.tspans, 0);
    expect(tspanTotal).toBeGreaterThan(NARROW_FRAME_CONDITIONS.length);
  });
});
