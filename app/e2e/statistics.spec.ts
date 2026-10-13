// Work statistics from agent reports (<work>/.atlas/statistics.jsonl in the fixture) and Git: the
// Statistics view's Work and Models tabs, and the About sidebar of a work item. The fixture has an
// older unmeasured session, a Claude Code session measured with a helper, and a measured Codex one.
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { close, launch, planningFixture, removeDirectory, type Launched } from './app';

let launched: Launched | undefined;
let folder: string;
/** Numbers as the window formats them, whatever the system locale. */
const compact = (window: import('@playwright/test').Page, value: number) => window.evaluate(number => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(number), value);
const whole = (window: import('@playwright/test').Page, value: number) => window.evaluate(number => number.toLocaleString(), value);
test.beforeEach(() => { folder = planningFixture(); });
test.afterEach(async () => { await close(launched); launched = undefined; removeDirectory(path.dirname(folder)); });

test('the Work tab lists each work item with its model, agent time, tokens, plan revisions and steps', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await window.getByRole('button', { name: 'Statistics' }).click();
  await expect(window.getByRole('tablist', { name: 'Statistics sections' }).locator('[role="tab"][aria-selected="true"]')).toHaveText('Work');
  await expect(window.locator('.stats-grid .stat').first().locator('.stat-value')).toHaveText('2');
  const agentTime = window.locator('.stats-grid .stat', { hasText: 'Agent time' });
  await expect(agentTime.locator('.stat-value')).toHaveText('6 h 48 min');
  await expect(agentTime.locator('.stat-note')).toHaveText('78% measured from session logs');
  await expect(window.locator('.stats-grid .stat', { hasText: 'Tokens' }).locator('.stat-note')).toHaveText('measured and self-reported');
  const payments = window.locator('.work-statistics-table tr', { hasText: 'Saved payment methods' });
  const model = payments.locator('td').nth(1);
  await expect(model.locator('.model-name')).toHaveText('Claude Opus 5.5');
  await expect(model.locator('.model-name')).toHaveAttribute('title', /^claude-opus-5-5 · Anthropic · 2 h 38 min, /);
  await expect(model.locator('.provider-mark')).toHaveAttribute('data-provider', 'anthropic');
  await expect(model).toContainText('+2');
  await expect(payments.locator('td').nth(2)).toHaveText('4 h 8 min');
  await expect(payments.locator('td').nth(2)).toHaveAttribute('title', /measured from the agent's session logs and 1 h 30 min estimated/);
  await expect(payments.locator('td').nth(3)).toHaveText(await compact(window, 13815500));
  await expect(payments.locator('td').nth(3)).toHaveAttribute('title', /^Cached input .+ · Cache writes .+ · Input .+ · Output .+ · Self-reported .+$/);
  await expect(payments.locator('td').nth(4)).toHaveText('0');
  await expect(payments.locator('td').nth(5)).toHaveText('2/7');
  const inventory = window.locator('.work-statistics-table tr', { hasText: 'Inventory reservations' });
  await expect(inventory.locator('td').nth(1).locator('.model-name')).toHaveText('GPT-6.1 Sol');
  await expect(inventory.locator('td').nth(1).locator('.provider-mark')).toHaveAttribute('data-provider', 'openai');
  await expect(inventory.locator('td').nth(2)).toHaveText('2 h 40 min');
  await expect(inventory.locator('td').nth(3)).toHaveText(await compact(window, 3688300));
  const draft = window.locator('.work-statistics-table tr', { hasText: 'Order fulfilment model' });
  await expect(draft.locator('td').nth(1)).toHaveText('—');
});

test('the Models tab plots completed work over time by implementing model, with a table and a tooltip', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await window.getByRole('button', { name: 'Statistics' }).click();
  await window.getByRole('tablist', { name: 'Statistics sections' }).getByRole('tab', { name: 'Models over time' }).click();
  await expect(window.locator('.chart-dot')).toHaveCount(1);
  await expect(window.locator('.chart-legend')).toContainText('GPT-6.1 Sol');
  await expect(window.locator('.chart-legend .provider-mark')).toHaveAttribute('data-plain', '');
  const row = window.locator('.model-table tbody tr', { hasText: 'GPT-6.1 Sol' });
  await expect(row.locator('td').nth(1)).toHaveText('1');
  await expect(row.locator('td').nth(2)).toHaveText('2 h 40 min');
  await expect(row.locator('td').nth(3)).toHaveText(await compact(window, 3688300));
  await window.locator('.chart-dot').hover();
  await expect(window.locator('.chart-tooltip')).toContainText('Inventory reservations');
  await expect(window.locator('.chart-tooltip')).toContainText('GPT-6.1 Sol');
  await expect(window.locator('.chart-tooltip strong')).toHaveText('2 h 40 min');
  await window.getByLabel('Measure').getByText('Tokens').click();
  await expect(window.locator('.chart-dot')).toHaveCount(1);
  await window.getByLabel('Measure').getByText('Plan revisions').click();
  await expect(window.locator('.chart-dot')).toHaveCount(1);
  // Keyboard: focus the chart, move to the dot and open its work item.
  await window.locator('.chart-frame').focus();
  await window.keyboard.press('ArrowRight');
  await expect(window.locator('.chart-tooltip')).toContainText('Inventory reservations');
  await window.keyboard.press('Enter');
  await expect(window.locator('.work-header h1')).toHaveText(/^Inventory reservations/);
});

test('a work item\'s About sidebar sums up its statistics, with what agent time and tokens stand for on hover and focus', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await window.locator('.work-row a', { hasText: 'Saved payment methods' }).click();
  const statistics = window.locator('.about-section', { has: window.locator('h2', { hasText: 'Statistics' }) });
  await expect(statistics.locator('.work-statistics-primary')).toHaveText('Claude Opus 5.5');
  await expect(statistics.locator('.work-statistics-model .provider-mark')).toHaveAttribute('data-provider', 'anthropic');
  await expect(statistics.locator('.work-statistics-others')).toHaveText('with Claude Sonnet 4.5 and Claude Haiku 5.5');
  const facts = statistics.locator('.work-statistics-facts li');
  // As shown: each value's description is for assistive technology.
  await expect(facts).toHaveText(['4 h 8 min of agent time', (await compact(window, 13815500)) + ' tokens', '0 plan revisions'], { useInnerText: true });
  await expect(window.locator('.about')).not.toContainText('active/0001-saved-payment-methods', { timeout: 1000 });
  await facts.nth(0).locator('.detailed').hover();
  await expect(window.locator('.env-tooltip')).toContainText('Measured from logs2 h 38 min');
  await expect(window.locator('.env-tooltip')).toContainText('Estimated from reports1 h 30 min');
  await expect(window.locator('.env-tooltip')).toContainText('Since ');
  await window.mouse.move(0, 0);
  await expect(window.locator('.env-tooltip')).toHaveCount(0);
  // Keyboard: Tab moves from agent time to the token count, which shows its breakdown.
  await facts.nth(0).locator('.detailed').focus();
  await window.keyboard.press('Tab');
  await expect(facts.nth(1).locator('.detailed')).toBeFocused();
  await expect(window.locator('.env-tooltip')).toContainText('Cached input' + await compact(window, 12959000));
  await expect(window.locator('.env-tooltip')).toContainText('Self-reported' + await compact(window, 120000));
  await expect(window.locator('.env-tooltip')).toContainText('Total' + await whole(window, 13815500));
  await expect(facts.nth(1).locator('.detailed')).toHaveAccessibleDescription(/^Cached input .+ · Self-reported .+$/);
});
