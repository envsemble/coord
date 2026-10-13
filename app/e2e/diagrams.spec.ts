import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { close, launch, planningFixture, removeDirectory, type Launched } from './app';

let launched: Launched | undefined;
let folder: string;
test.beforeEach(() => { folder = planningFixture(); });
test.afterEach(async () => { await close(launched); launched = undefined; removeDirectory(path.dirname(folder)); });

async function openDiagrams(window: Page, title: string) {
  await expect(window.locator('.work-row').first()).toBeVisible();
  await window.keyboard.press('Control+P');
  const palette = window.getByRole('dialog', { name: 'Quick open' });
  await palette.getByRole('combobox').fill(title);
  await expect(palette.getByRole('option').first()).toContainText(title);
  await palette.getByRole('combobox').press('Enter');
  await expect(window.locator('.model-picker-title')).toHaveText(title);
  await expect(window.locator('.diagrams .node').first()).toBeVisible();
}

test('the picker lists diagrams by origin, one short line each, and switches models', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await openDiagrams(window, 'Checkout · captured TypeScript');
  await expect(window.locator('.diagrams .atlas-panel').first()).toContainText('Generated from code');
  await window.locator('.model-picker-button').click();
  const menu = window.getByRole('menu', { name: 'Choose a diagram' });
  const captured = menu.getByRole('group', { name: 'From code and databases' });
  await expect(captured).toContainText('Checkout · captured TypeScript');
  await expect(captured).toContainText('TypeScript · captured Sep 14, 2026');
  const proposals = menu.getByRole('group', { name: 'Proposals' });
  await expect(proposals).toContainText('Changes to the code captured Sep 14, 2026');
  // What a model explains is no longer listed in the menu.
  await expect(menu).not.toContainText('Explains');
  await menu.getByRole('menuitemradio', { name: /Checkout · proposed payment methods/ }).click();
  await expect(window.locator('.model-picker-title')).toHaveText('Checkout · proposed payment methods');
  // Choosing a diagram is working in the tab, so it is pinned.
  await expect(window.getByRole('tablist', { name: 'Open tabs' }).locator('[role="tab"][aria-selected="true"]')).toHaveAttribute('data-preview', 'false');
});

test('a proposal opens on its changes: the overview leads to each change, and details explain it', async () => {
  launched = await launch({ folder });
  const { window, app } = launched;
  // A typical window leaves room for the overview beside the diagram.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await openDiagrams(window, 'Checkout · proposed payment methods');
  // One way to choose what is shown: no Baseline/Changes control.
  await expect(window.getByRole('radio', { name: 'Baseline' })).toHaveCount(0);
  const changes = window.getByRole('button', { name: /^Changes, \d+$/ });
  await expect(changes).toHaveAttribute('aria-pressed', 'true');
  const overview = window.getByRole('complementary', { name: 'Changes in this proposal' });
  await expect(overview).toContainText('Compared with the code captured Sep 14, 2026.');
  // Changes are marked on the canvas, and what stays the same fades.
  await expect(window.locator('.diagrams .node[data-change="added"][data-name="SavedPaymentMethod"]')).toBeVisible();
  await expect(window.locator('.diagrams .viewer.fade-unchanged')).toHaveCount(1);
  const row = overview.locator('button.change-row', { has: window.locator('.change-row-name', { hasText: /^CheckoutService$/ }) });
  await expect(row).toContainText('vault');
  await row.click();
  const details = window.getByRole('complementary', { name: 'Model details' });
  await expect(details.getByRole('heading', { level: 1 })).toHaveText('CheckoutService');
  await expect(details.getByRole('region', { name: 'What changes' })).toContainText('placeOrderWithSavedMethod');
  await expect(details.getByRole('region', { name: 'Where in code' })).toContainText('src/checkout/CheckoutService.ts');
  await expect(details.getByRole('region', { name: 'Why' })).toContainText('Checkout flow');
  for (const noise of ['observed', 'Capture ·', 'Mappings']) await expect(details).not.toContainText(noise);
  // Keyboard focus lands on the way back; the next change follows.
  await expect(details.getByRole('button', { name: 'All changes' })).toBeFocused();
  const position = details.locator('.change-position');
  const before = await position.textContent();
  await details.getByRole('button', { name: 'Next change' }).click();
  await expect(position).not.toHaveText(before ?? '');
  await details.getByRole('button', { name: 'All changes' }).click();
  await expect(overview).toBeVisible();
  // The Changes button hides the overview and shows it again.
  await changes.click();
  await expect(overview).toBeHidden();
  await changes.click();
  await expect(overview).toBeVisible();
});

test('the keyboard steps through changes without losing focus or entering a folded list', async () => {
  launched = await launch({ folder });
  const { window, app } = launched;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await openDiagrams(window, 'Checkout · proposed payment methods');
  const overview = window.getByRole('complementary', { name: 'Changes in this proposal' });
  const row = (name: string) => overview.locator('button.change-row', { has: window.locator('.change-row-name', { hasText: new RegExp(`^${name}$`) }) });
  // Down from the last new type reaches the folded relations' summary, not a hidden row inside.
  await row('SavedPaymentMethod').focus();
  await window.keyboard.press('ArrowDown');
  await expect(overview.locator('.change-relations > summary').first()).toBeFocused();
  await window.keyboard.press('ArrowDown');
  await expect(row('AcquirerGateway')).toBeFocused();
  await window.keyboard.press('End');
  await expect(row('PaymentGateway')).toBeFocused();
  // At the last change, Next stays focused and says it has nowhere to go.
  await window.keyboard.press('Enter');
  const details = window.getByRole('complementary', { name: 'Model details' });
  await expect(details.locator('.change-position')).toContainText('15 of 15');
  const next = details.getByRole('button', { name: 'Next change' });
  await next.focus();
  await window.keyboard.press('Enter');
  await expect(next).toBeFocused();
  await expect(next).toHaveAttribute('aria-disabled', 'true');
  await expect(details.locator('.change-position')).toContainText('15 of 15');
  // The position names the change it announces.
  await expect(details.locator('.change-position')).toContainText('PaymentGateway');
});

test('an authored model opens its guide and a full view', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await openDiagrams(window, 'Fulfilment · conceptual model');
  // The model report is gone; its walkthrough and examples guide the model.
  await expect(window.getByRole('button', { name: 'Open model report' })).toHaveCount(0);
  const understand = window.getByRole('button', { name: 'Understand the model' });
  await understand.click();
  const guide = window.getByRole('complementary', { name: 'Model guide' });
  await expect(guide).toContainText('How one order becomes several shipments');
  await expect(guide).toContainText('Order 1042 split across Berlin and Leeds');
  await understand.click();
  await expect(guide).toBeHidden();
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
  await expect(window.getByRole('tablist', { name: 'Work sections' }).locator('[role="tab"][aria-selected="true"]')).toContainText('Plan');
  const chip = window.locator('.element-chip').first();
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(window.locator('.inspector.open')).toBeVisible();
  // Why the element exists: its planning passages, each a link back to the plan.
  const why = window.locator('.inspector.open').getByRole('region', { name: 'Why' });
  await expect(why).toBeVisible();
  await why.getByRole('button', { name: /^Open Plan › / }).first().click();
  await expect(window.getByRole('tablist', { name: 'Work sections' }).locator('[role="tab"][aria-selected="true"]')).toContainText('Plan');
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
    // The box's change border and the ring around it lie within the outer 12 pixels.
    for (let y = Math.round(height * 0.5); y < Math.round(height * 0.9); y++) {
      for (let x = 12; x < width - 12; x++) {
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
  // A fixed window size, so the measured node is clear of the floating toolbars.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  // The measurement looks for light text on a dark box.
  await window.emulateMedia({ colorScheme: 'dark' });
  await openDiagrams(window, 'Checkout · proposed payment methods');
  const zoom =window.getByRole('button', { name: /^Zoom \d+%/ });
  for (const step of ['fit', 'out'] as const) {
    // The canvas's own zoom-out key (the toolbar may fold its zoom buttons away in a narrow window).
    if (step === 'out') await window.keyboard.press('-');
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
