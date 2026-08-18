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
  for (const demoLink of [page.locator('.demo.en'), page.locator('.demo.zh')]) {
    await expect(demoLink).toHaveAttribute('target', '_blank');
    await expect(demoLink).toHaveAttribute('rel', 'noopener');
  }
  await expect(page.locator('.demo.en')).toHaveAttribute('href', './en/');
  await expect(page.locator('.demo.zh')).toHaveAttribute('href', './zh-CN/');
  const box = await projectLink.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  const repositoryPagePromise = page.context().waitForEvent('page');
  await projectLink.click();
  const repositoryPage = await repositoryPagePromise;
  await expect(repositoryPage).toHaveURL(repositoryUrl);
});
