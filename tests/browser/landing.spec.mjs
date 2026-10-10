import { test, expect } from './runtime-dependencies.fixture.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const landingUrl = pathToFileURL(path.resolve('examples/demo/landing.html')).href;
const repositoryUrl = 'https://github.com/YuLaiZ/interactive-code-map';

test('入口页项目链接具有明确的点击区域并跳转到仓库', async ({ page }) => {
  await page.route(repositoryUrl, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>Repository</title>',
  }));
  await page.goto(landingUrl);
  const projectLink = page.locator('.project-link');
  await expect(projectLink).toHaveAttribute('href', repositoryUrl);
  await expect(projectLink).toContainText('Install from GitHub');
  await expect(projectLink).toContainText('从 GitHub 安装');
  await expect(projectLink).toHaveAttribute('target', '_blank');
  await expect(projectLink).toHaveAttribute('rel', 'noopener');
  await expect(projectLink).toHaveCSS('cursor', 'pointer');
  // 每种图型一张卡,语言收进卡内链接;断言四个跳转链接的地址与外开属性。
  const demoLinks = [
    { card: '.demo.en', href: './en/', name: 'English demo' },
    { card: '.demo.en', href: './zh-CN/', name: '中文 Demo' },
    { card: '.demo.en-seq', href: './en/sequence/', name: 'English demo' },
    { card: '.demo.en-seq', href: './zh-CN/sequence/', name: '中文 Demo' },
  ];
  for (const item of demoLinks) {
    const link = page.locator(`${item.card} .demo-link[href="${item.href}"]`);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener');
    await expect(link).toContainText(item.name);
  }
  const box = await projectLink.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  const repositoryPagePromise = page.context().waitForEvent('page');
  await projectLink.click();
  const repositoryPage = await repositoryPagePromise;
  await expect(repositoryPage).toHaveURL(repositoryUrl);
});
