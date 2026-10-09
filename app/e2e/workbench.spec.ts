import { expect, test } from '@playwright/test';
import { close, launch, planningFixture, removeDirectory, temporaryDirectory, type Launched } from './app';

let launched: Launched | undefined;
let folder: string;
test.beforeEach(() => { folder = planningFixture(); });
test.afterEach(async () => { await close(launched); launched = undefined; removeDirectory(folder); });

const row = (id: string) => `.tree-row[data-id="${id}"]`;

test('opening a folder from the command line shows its work list in a window named after it', async () => {
  launched = await launch({ folder });
  const { window, app } = launched;
  await expect(window.locator('.work-row')).toHaveCount(3);
  await expect(window.locator('.work-row').first()).toContainText('Customer order notifications');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(item => item.getTitle()))).toEqual(['planning — Atlas']);
  await expect(window.locator('.tab.active')).toHaveText(/Work/);
  await expect(window.locator('.explorer-title')).toHaveText(/planning/i);
});

test('the explorer mirrors the folder: work folders show status and title, a Diagrams entry lists models', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await expect(window.locator(row('d:active'))).toBeVisible();
  await expect(window.locator('.tree-row', { hasText: '.atlas' })).toHaveCount(0);
  await window.locator(row('d:active')).click();
  const work = window.locator(row('d:active/0001-saved-payment-methods'));
  await expect(work).toContainText('0001-saved-payment-methods');
  await expect(work.locator('.tree-secondary')).toHaveText('#0001 Saved payment methods');
  await expect(work.locator('.status-icon')).toHaveAttribute('aria-label', 'In progress');

  // Clicking a work folder expands it and opens its overview in a preview tab.
  await work.click();
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await expect(window.locator('.tab.active.preview')).toContainText('Saved payment methods');
  await expect(window.locator(row('g:work-0001'))).toContainText('Diagrams');
  await window.locator(row('g:work-0001')).click();
  const diagram = window.locator(row('m:work-0001:m-024410515ef6611f71e02bdc'));
  await expect(diagram).toContainText('Checkout · proposed payment methods');
  await expect(diagram.locator('.label')).toHaveText('Agent proposal');
  await expect(window.locator(row('m:work-0001:m-66a2183cd2019ea903061470')).locator('.label')).toHaveText('Generated from code');

  // A diagram opens the Diagrams view focused on it, in the same (still preview) work tab.
  await diagram.click();
  await expect(window.locator('.model-picker-title')).toHaveText('Checkout · proposed payment methods');
  await expect(window.locator('.underline-nav a.selected')).toContainText('Diagrams');

  // A file opens in its own tab, replacing the preview.
  await window.locator(row('f:active/0001-saved-payment-methods/CONTEXT.md')).click();
  await expect(window.locator('.tab')).toHaveCount(2);
  await expect(window.locator('.tab.active.preview')).toContainText('CONTEXT.md');
  await expect(window.locator('.reader-name')).toContainText('CONTEXT.md');
  await expect(window.locator('.prose h1, .prose h2').first()).toBeVisible();
});

test('tabs: single click previews, double click pins, Ctrl+W closes; tabs and sidebar persist per folder', async () => {
  const dataDirectory = temporaryDirectory('atlas-e2e-data-');
  launched = await launch({ folder, dataDirectory });
  let { window } = launched;
  await window.locator(row('d:knowledge')).click();
  await window.locator(row('d:knowledge/shop')).click();
  await window.locator(row('f:knowledge/shop/inventory-schema.md')).click();
  await expect(window.locator('.tab.preview')).toContainText('inventory-schema.md');
  await window.locator(row('f:knowledge/shop/payments-constraints.md')).click();
  await expect(window.locator('.tab')).toHaveCount(2);
  await expect(window.locator('.tab.preview')).toContainText('payments-constraints.md');
  await window.locator(row('f:knowledge/shop/payments-constraints.md')).dblclick();
  await expect(window.locator('.tab.preview')).toHaveCount(0);
  await window.locator(row('f:knowledge/shop/inventory-schema.md')).click();
  await expect(window.locator('.tab')).toHaveCount(3);
  await window.keyboard.press('Control+W');
  await expect(window.locator('.tab')).toHaveCount(2);
  await expect(window.locator('.tab.active')).toContainText('payments-constraints.md');

  // Ctrl+B hides the explorer; the divider resizes it.
  await window.keyboard.press('Control+B');
  await expect(window.locator('.explorer')).toHaveCount(0);
  await window.keyboard.press('Control+B');
  await expect(window.locator('.explorer')).toBeVisible();
  const divider = window.locator('.split-pane-divider');
  await divider.focus();
  await window.keyboard.press('ArrowRight');
  await window.keyboard.press('ArrowRight');
  const width = Number(await divider.getAttribute('aria-valuenow'));
  expect(width).toBe(312);
  await window.waitForTimeout(600);
  await close(launched);

  launched = await launch({ dataDirectory });
  window = launched.window;
  await expect(window.locator('.tab')).toHaveCount(2);
  await expect(window.locator('.tab.active')).toContainText('payments-constraints.md');
  await expect(window.locator('.split-pane-divider')).toHaveAttribute('aria-valuenow', '312');
  await expect(window.locator(row('f:knowledge/shop/payments-constraints.md'))).toHaveClass(/selected/);
  removeDirectory(dataDirectory);
});

test('quick open finds work items, diagrams and files by name', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await expect(window.locator('.work-row')).toHaveCount(3);
  await window.keyboard.press('Control+P');
  const input = window.locator('.quick-open input');
  await expect(input).toBeFocused();
  await input.fill('fulfil');
  await expect(window.locator('.quick-open-item').first()).toContainText('Order fulfilment model');
  await input.press('Enter');
  await expect(window.locator('.work-header h1')).toHaveText('Order fulfilment model');

  await window.keyboard.press('Control+P');
  await input.fill('reservation proposal');
  await expect(window.locator('.quick-open-item').first()).toContainText('Inventory · reservation proposal');
  await input.press('Enter');
  await expect(window.locator('.model-picker-title')).toHaveText('Inventory · reservation proposal');

  await window.keyboard.press('Control+P');
  await input.fill('payments-cons');
  await expect(window.locator('.quick-open-item').first()).toContainText('payments-constraints.md');
  await input.press('Escape');
  await expect(window.locator('.quick-open')).toHaveCount(0);
});

test('activity and statistics open from the activity bar', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await window.getByRole('button', { name: 'Activity' }).click();
  await expect(window.locator('.activity-row')).toHaveCount(1);
  await expect(window.locator('.activity-row')).toContainText('Fixture planning folder');
  await window.getByRole('button', { name: 'Statistics' }).click();
  await expect(window.locator('.stats-grid .stat')).toHaveCount(4);
  await window.getByRole('button', { name: 'Explorer' }).click();
  await expect(window.locator('.explorer')).toHaveCount(0);
});

test('the work page keeps the plan, ledger and diagrams sections, the About sidebar and inline diagram cards', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await window.locator('.work-row', { hasText: 'Saved payment methods' }).getByRole('link', { name: 'Saved payment methods' }).click();
  await expect(window.locator('.underline-nav a')).toHaveText([/Plan/, /Ledger/, /Diagrams\s*2/]);
  await expect(window.locator('.state-label')).toHaveText('In progress');
  await expect(window.locator('.about')).toContainText('Adding authoriseWithToken');
  await window.locator('.underline-nav a', { hasText: 'Plan' }).click();
  await expect(window.locator('.diagram-card').first()).toBeVisible();
  await expect(window.locator('.diagram-card .label').first()).toBeVisible();
  await window.locator('.diagram-card').first().getByRole('button', { name: 'Open diagram' }).click();
  await expect(window.locator('.diagrams .atlas-panel').first()).toBeVisible();
  await expect(window.locator('.tab.active')).toContainText('Diagrams');
});
