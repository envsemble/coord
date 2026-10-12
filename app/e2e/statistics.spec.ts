// Work statistics from agent reports (<work>/.atlas/statistics.jsonl in the fixture) and Git:
// the Statistics view's Work and Models tabs, and the About sidebar of a work item.
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { close, launch, planningFixture, removeDirectory, type Launched } from './app';

let launched: Launched | undefined;
let folder: string;
/** Numbers as the window formats them, whatever the system locale. */
const compact = (window: import('@playwright/test').Page, value: number) => window.evaluate(number => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(number), value);
test.beforeEach(() => { folder = planningFixture(); });
test.afterEach(async () => { await close(launched); launched = undefined; removeDirectory(path.dirname(folder)); });

test('the Work tab lists each work item with its reported model, tokens, active time, plan revisions and steps', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await window.getByRole('button', { name: 'Statistics' }).click();
  await expect(window.getByRole('tablist', { name: 'Statistics sections' }).locator('[role="tab"][aria-selected="true"]')).toHaveText('Work');
  await expect(window.locator('.stats-grid .stat').first().locator('.stat-value')).toHaveText('2');
  const payments = window.locator('.work-statistics-table tr', { hasText: 'Saved payment methods' });
  await expect(payments.locator('td').nth(1)).toHaveText('model-alpha-2');
  await expect(payments.locator('td').nth(2)).toHaveText(await compact(window, 210000));
  await expect(payments.locator('td').nth(3)).toHaveText('2 h 30 min');
  await expect(payments.locator('td').nth(4)).toHaveText('0');
  await expect(payments.locator('td').nth(5)).toHaveText('2/7');
  const inventory = window.locator('.work-statistics-table tr', { hasText: 'Inventory reservations' });
  await expect(inventory.locator('td').nth(2)).toHaveText(await compact(window, 335000));
  await expect(inventory.locator('td').nth(3)).toHaveText('3 h');
  const draft = window.locator('.work-statistics-table tr', { hasText: 'Order fulfilment model' });
  await expect(draft.locator('td').nth(1)).toHaveText('—');
});

test('the Models tab plots completed work over time by implementing model, with a table and a tooltip', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await window.getByRole('button', { name: 'Statistics' }).click();
  await window.getByRole('tablist', { name: 'Statistics sections' }).getByRole('tab', { name: 'Models over time' }).click();
  await expect(window.locator('.chart-dot')).toHaveCount(1);
  await expect(window.locator('.chart-legend')).toContainText('model-beta-1');
  const row = window.locator('.model-table tbody tr', { hasText: 'model-beta-1' });
  await expect(row.locator('td').nth(1)).toHaveText('1');
  await expect(row.locator('td').nth(2)).toHaveText(await compact(window, 335000));
  await expect(row.locator('td').nth(3)).toHaveText('3 h');
  await window.locator('.chart-dot').hover();
  await expect(window.locator('.chart-tooltip')).toContainText('Inventory reservations');
  await expect(window.locator('.chart-tooltip strong')).toHaveText(await compact(window, 335000));
  await window.getByLabel('Measure').getByText('Plan revisions').click();
  await expect(window.locator('.chart-dot')).toHaveCount(1);
  // Keyboard: focus the chart, move to the dot and open its work item.
  await window.locator('.chart-frame').focus();
  await window.keyboard.press('ArrowRight');
  await expect(window.locator('.chart-tooltip')).toContainText('Inventory reservations');
  await window.keyboard.press('Enter');
  await expect(window.locator('.work-header h1')).toHaveText(/^Inventory reservations/);
});

test('a work item\'s About sidebar shows its statistics', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await window.locator('.work-row a', { hasText: 'Saved payment methods' }).click();
  const statistics = window.locator('.about-section', { has: window.locator('h2', { hasText: 'Statistics' }) });
  await expect(statistics.locator('dd').nth(0)).toHaveText('model-alpha-2');
  await expect(statistics.locator('dd').nth(1)).toHaveText(await compact(window, 210000));
  await expect(statistics.locator('dd').nth(2)).toHaveText('2 h 30 min');
  await expect(statistics.locator('dd').nth(3)).toHaveText('0');
});
