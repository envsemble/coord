import { expect, test, type Locator, type Page } from '@playwright/test';
import { close, launch, planningFixture, removeDirectory, type Launched } from './app';

let launched: Launched | undefined;
let folder: string;
test.beforeEach(() => { folder = planningFixture(); });
test.afterEach(async () => { await close(launched); launched = undefined; removeDirectory(folder); });

async function openDiagrams(window: Page, title: string) {
  await expect(window.locator('.work-row').first()).toBeVisible();
  await window.keyboard.press('Control+P');
  await window.locator('.quick-open input').fill(title);
  await expect(window.locator('.quick-open-item').first()).toContainText(title);
  await window.locator('.quick-open input').press('Enter');
  await expect(window.locator('.model-picker-title')).toHaveText(title);
  await expect(window.locator('.diagrams .node').first()).toBeVisible();
}

test('the picker groups diagrams by provenance and switches models', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await openDiagrams(window, 'Checkout · captured TypeScript');
  await expect(window.locator('.diagrams .atlas-panel').first()).toContainText('Generated from code');
  await window.locator('.model-picker-button').click();
  const menu = window.locator('.model-menu');
  await expect(menu.getByRole('group', { name: 'Generated from code or database' })).toContainText('Checkout · captured TypeScript');
  await expect(menu.getByRole('group', { name: 'Agent proposals' })).toContainText('Checkout · proposed payment methods');
  await menu.getByRole('menuitemradio', { name: /Checkout · proposed payment methods/ }).click();
  await expect(window.locator('.model-picker-title')).toHaveText('Checkout · proposed payment methods');
  // Choosing a diagram is working in the tab, so it is pinned.
  await expect(window.locator('.tab.active')).not.toHaveClass(/preview/);
});

test('a proposal compares Baseline and Changes, and the inspector shows a selected element', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await openDiagrams(window, 'Checkout · proposed payment methods');
  const comparison = window.getByRole('group', { name: 'Comparison' });
  await expect(comparison.locator('button[data-mode="changes"]')).toHaveAttribute('aria-current', 'true');
  await window.locator('.change-counts').click();
  await expect(window.getByRole('dialog', { name: 'Semantic changes' })).toBeVisible();
  await window.keyboard.press('Escape');
  await comparison.locator('button[data-mode="baseline"]').click();
  await expect(comparison.locator('button[data-mode="baseline"]')).toHaveAttribute('aria-current', 'true');
  await window.locator('.diagrams .node', { has: window.getByText('PaymentGateway', { exact: true }) }).first().click();
  await expect(window.locator('.inspector.open')).toBeVisible();
  await expect(window.locator('.inspector.open')).toContainText('PaymentGateway');
});

test('an authored model opens its report and a full view', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await openDiagrams(window, 'Fulfilment · conceptual model');
  await window.getByRole('button', { name: 'Open model report' }).click();
  await expect(window.getByRole('article', { name: 'Model report' })).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(window.getByRole('article', { name: 'Model report' })).toHaveCount(0);
  // Full view hides the work header; Escape returns.
  await window.getByRole('button', { name: /full ?screen|full view/i }).first().click();
  await expect(window.locator('.diagrams.fullscreen')).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(window.locator('.diagrams.fullscreen')).toHaveCount(0);
});

test('an element chip in the plan opens the diagram at that element, and its planning reference returns to the plan', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await window.locator('.work-row', { hasText: 'Order fulfilment model' }).getByRole('link', { name: 'Order fulfilment model' }).click();
  await expect(window.locator('.underline-nav a.selected')).toContainText('Plan');
  const chip = window.locator('.element-chip').first();
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(window.locator('.inspector.open')).toBeVisible();
  const references = window.getByRole('region', { name: 'Planning references' });
  await expect(references).toBeVisible();
  await references.locator('summary').first().click();
  await references.getByRole('button', { name: /^Open / }).first().click();
  await expect(window.locator('.underline-nav a.selected')).toContainText('Plan');
  await expect(window.locator('.prose')).toBeVisible();
});

/**
 * Where a node's name is painted, measured in a screenshot (layout boxes cannot show this: the bug
 * they miss is glyphs painted wider than their laid-out text). Returns the blank space left and
 * right of the light text pixels in the band holding the name.
 */
async function paintedNameMargins(window: Page, node: Locator) {
  const png = (await node.screenshot()).toString('base64');
  return window.evaluate(async source => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + source;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
    let left = width, right = -1;
    // The name line sits in the lower half of a header-only node; the change marker is at the top left.
    for (let y = Math.round(height * 0.5); y < Math.round(height * 0.9); y++) {
      for (let x = 4; x < width - 4; x++) {
        const offset = (y * width + x) * 4;
        if (0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2] > 170) { left = Math.min(left, x); right = Math.max(right, x); }
      }
    }
    return { left, right: width - 1 - right, width };
  }, png);
}

test('node names stay centred in their boxes below 100% zoom', async () => {
  launched = await launch({ folder });
  const { window, app } = launched;
  // Wide enough for the canvas toolbar to show its zoom buttons.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await openDiagrams(window, 'Checkout · proposed payment methods');
  const zoom =window.getByRole('button', { name: /^Zoom \d+%/ });
  for (const step of ['fit', 'out'] as const) {
    if (step === 'out') await window.getByRole('button', { name: 'Zoom out' }).click();
    const percent = Number(/Zoom (\d+)%/.exec((await zoom.getAttribute('aria-label')) ?? '')?.[1]);
    expect(percent).toBeLessThan(100);
    // Let the camera settle before measuring paint.
    await window.waitForTimeout(600);
    await window.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const node = window.locator('.diagrams .node[data-name="PaymentMethodVault"]').first();
    const margins = await paintedNameMargins(window, node);
    expect(margins.right, `painted name reaches the box edge at ${percent}%`).toBeGreaterThan(4);
    expect(Math.abs(margins.left - margins.right), `name off centre at ${percent}%: ${JSON.stringify(margins)}`).toBeLessThanOrEqual(6);
  }
});
