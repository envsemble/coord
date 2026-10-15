// Work statistics from agent reports (<work>/.atlas/statistics.jsonl in the fixture, imported into the
// home's database as the fixture is adopted into it) and Git: the project page's Statistics section,
// its Work and Models tabs, and the About sidebar of a work item. The fixture has an
// unmeasured planning session, a Claude Code implementation session measured with a subagent, and a
// measured Codex one from before stages were recorded.
import { expect, test } from '@playwright/test';
import { close, launchProject, type Launched } from './app';

let launched: Launched | undefined;
/** Numbers as the window formats them, whatever the system locale. */
const compact = (window: import('@playwright/test').Page, value: number) => window.evaluate(number => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(number), value);
const whole = (window: import('@playwright/test').Page, value: number) => window.evaluate(number => number.toLocaleString(), value);
test.afterEach(async () => { await close(launched); launched = undefined; });

test('the Work tab lists each work item with its model, planning and implementation, subagents, plan revisions and steps', async () => {
  launched = await launchProject();
  const { window } = launched;
  // The same segmented control as the work list's filter.
  await expect(window.getByRole('radiogroup', { name: 'Statistics sections' }).getByRole('radio', { name: 'Work' })).toBeChecked();
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
  // Planning, implementation and, as the Codex reports have no stage, a column for those.
  await expect(window.locator('.work-statistics-table th')).toHaveText(['Work', 'Model', 'Planning', 'Implementation', 'Stage not recorded', 'Subagents', 'Plan revisions', 'Steps']);
  const planning = payments.locator('td').nth(2), implementation = payments.locator('td').nth(3);
  await expect(planning).toContainText('1 h 30 min');
  await expect(planning.locator('.cell-note')).toHaveText((await compact(window, 120000)) + ' tokens');
  await expect(planning).toHaveAttribute('title', /^Self-reported .+$/);
  await expect(implementation).toContainText('2 h 38 min');
  await expect(implementation.locator('.cell-note')).toHaveText((await compact(window, 13695500)) + ' tokens');
  await expect(implementation).toHaveAttribute('title', /^Cached input .+ · Cache writes .+ · Input .+ · Output .+$/);
  await expect(payments.locator('td').nth(4)).toHaveText('—');
  await expect(payments.locator('td').nth(5).locator('.cell-note')).toHaveText('18 min');
  await expect(payments.locator('td').nth(5)).toHaveAttribute('title', '1 subagent, 18 min');
  await expect(payments.locator('td').nth(6)).toHaveText('0');
  await expect(payments.locator('td').nth(7)).toHaveText('2/7');
  const inventory = window.locator('.work-statistics-table tr', { hasText: 'Inventory reservations' });
  await expect(inventory.locator('td').nth(1).locator('.model-name')).toHaveText('GPT-6.1 Sol');
  await expect(inventory.locator('td').nth(1).locator('.provider-mark')).toHaveAttribute('data-provider', 'openai');
  await expect(inventory.locator('td').nth(2)).toHaveText('—');
  await expect(inventory.locator('td').nth(3)).toHaveText('—');
  await expect(inventory.locator('td').nth(4)).toContainText('2 h 40 min');
  await expect(inventory.locator('td').nth(4).locator('.cell-note')).toHaveText((await compact(window, 3688300)) + ' tokens');
  await expect(inventory.locator('td').nth(5)).toHaveText('—');
  const draft = window.locator('.work-statistics-table tr', { hasText: 'Order fulfilment model' });
  await expect(draft.locator('td').nth(1)).toHaveText('—');
});

test('the Models tab plots completed work over time by implementing model, with a table and a tooltip', async () => {
  launched = await launchProject();
  const { window } = launched;
  await window.getByRole('radiogroup', { name: 'Statistics sections' }).getByRole('radio', { name: 'Models over time' }).click();
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

test('a work item\'s About sidebar sums up its statistics, by stage and with its subagents, with what agent time and tokens stand for on hover and focus', async () => {
  launched = await launchProject();
  const { window } = launched;
  await window.locator('.work-row a', { hasText: 'Saved payment methods' }).click();
  const statistics = window.locator('.about-section', { has: window.locator('h2', { hasText: 'Statistics' }) });
  await expect(statistics.locator('.work-statistics-primary')).toHaveText('Claude Opus 5.5');
  await expect(statistics.locator('.work-statistics-model .provider-mark')).toHaveAttribute('data-provider', 'anthropic');
  await expect(statistics.locator('.work-statistics-others')).toHaveText('with Claude Sonnet 4.5 and Claude Haiku 5.5');
  const facts = statistics.locator('.work-statistics-facts li');
  // As shown: each value's description is for assistive technology.
  await expect(facts).toHaveText([
    '4 h 8 min of agent time', (await compact(window, 13815500)) + ' tokens',
    '1 h 30 min planning · ' + (await compact(window, 120000)) + ' tokens', '2 h 38 min implementation · ' + (await compact(window, 13695500)) + ' tokens',
    '1 subagent · 18 min', '0 plan revisions',
  ], { useInnerText: true });
  await expect(window.locator('.about')).not.toContainText('active/0001-saved-payment-methods', { timeout: 1000 });
  // Where the About sidebar sits below the plan, the plan arriving moves it: hover once it has.
  await expect(window.locator('.reader .prose h2').first()).toBeVisible();
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
