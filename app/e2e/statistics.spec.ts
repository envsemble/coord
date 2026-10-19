// Work statistics from agent reports (<work>/.atlas/statistics.jsonl in the fixture, imported into the
// home's database as the fixture is adopted into it) and Git: the Statistics page, opened from the menu
// for one project at a time, its Work and Models tabs, the sidebar of a work item and its own statistics page. The fixture has an
// unmeasured planning session, a Claude Code implementation session measured with a subagent, and a
// measured Codex one from before stages were recorded.
import { expect, test, type Page } from '@playwright/test';
import { addProject, close, filterHub, goHome, launch, launchProject, openPlan, pageScroll, projectHome, removeDirectory, section, settledScroll, type Launched } from './app';

let launched: Launched | undefined;
/** Numbers as the window formats them, whatever the system locale. */
const compact = (window: import('@playwright/test').Page, value: number) => window.evaluate(number => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(number), value);
const whole = (window: import('@playwright/test').Page, value: number) => window.evaluate(number => number.toLocaleString(), value);
const homes: string[] = [];
test.afterEach(async () => { await close(launched); launched = undefined; for (const home of homes.splice(0)) removeDirectory(home); });
/** The Statistics section, of the project given or the one it chooses. */
async function openStatistics(window: Page, project = 'Northwind') {
  await section(window, 'Statistics').click();
  await expect(window.locator('.statistics-page h1')).toHaveText('Statistics');
  await expect(window.getByRole('combobox', { name: 'Project' })).toHaveText(new RegExp(project));
}

test('Statistics, a section of its own, shows one project at a time: the project of the plan last open, else the first; a wheel over its table scrolls the page', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  addProject(home.dataDirectory, 'coord', 'Coord');
  launched = await launch({ dataDirectory: home.dataDirectory });
  const { window, app } = launched;
  await openStatistics(window, 'Northwind');
  await expect(window.locator('.work-statistics-table')).toBeVisible();
  // The picker shows another project's.
  await window.getByRole('combobox', { name: 'Project' }).click();
  await window.getByRole('option', { name: 'Coord' }).click();
  await expect(window.getByRole('combobox', { name: 'Project' })).toHaveText(/Coord/);
  await expect(window.locator('.work-statistics-table')).toBeVisible();
  // Back returns to Northwind's.
  await window.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(window.getByRole('combobox', { name: 'Project' })).toHaveText(/Northwind/);
  // After a plan of Coord, Statistics shows Coord's.
  await goHome(window);
  await filterHub(window, 'Coord');
  await openPlan(window, 'Saved payment methods');
  await openStatistics(window, 'Coord');
  // A plan keeps its own statistics in its side column.
  await window.locator('.work-statistics-table tr', { hasText: 'Saved payment methods' }).getByRole('link').click();
  await expect(window.locator('.about-section h2', { hasText: 'Statistics' })).toBeVisible();

  // A wheel over the work statistics table scrolls the page.
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setContentSize(1200, 520); });
  await openStatistics(window, 'Coord');
  const table = window.getByRole('table', { name: 'Work statistics' });
  await expect(table.getByRole('row').nth(1)).toBeVisible();
  await table.evaluate(element => element.scrollIntoView({ block: 'center' }));
  const before = await settledScroll(window);
  const delta = before > 300 ? -250 : 250;
  // As far as the page can scroll that way, up to the wheel's step.
  const room = Math.min(100, await window.evaluate(down => { const element = document.querySelector('.env-window-frame-content')!; return down ? element.scrollHeight - element.clientHeight - element.scrollTop : element.scrollTop; }, delta > 0));
  expect(room).toBeGreaterThan(20);
  // A point over the table, within the window.
  const box = (await table.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: Math.min(Math.max(box.y, 140) + 80, box.y + box.height - 10) };
  expect(await window.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('table[aria-label="Work statistics"]')), point)).toBe(true);
  await window.mouse.move(point.x, point.y);
  await window.mouse.wheel(0, delta);
  await expect.poll(async () => Math.abs(await pageScroll(window) - before)).toBeGreaterThan(room - 2);
});

test("the Work tab lists each work item with its model, planning and implementation, subagents, plan revisions and steps; the Models tab plots completed work over time by implementing model; a work item's About sidebar sums up its statistics", async () => {
  launched = await launchProject();
  const { window } = launched;
  await openStatistics(window);
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

  // The Models tab plots completed work over time by implementing model, with a table and a tooltip.
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

  // A work item's sidebar keeps the headline (its model, agent time and tokens) with what agent time
  // stands for on hover and focus; its own statistics page has the rest. Recent activity is gone.
  await goHome(window);
  await openPlan(window, 'Saved payment methods');
  const statistics = window.locator('.about-section', { has: window.locator('h2', { hasText: 'Statistics' }) });
  await expect(statistics.locator('.work-statistics-primary')).toHaveText('Claude Opus 5.5');
  await expect(statistics.locator('.work-statistics-model .provider-mark')).toHaveAttribute('data-provider', 'anthropic');
  await expect(statistics.locator('.work-statistics-others')).toHaveText('with Claude Sonnet 4.5 and Claude Haiku 5.5');
  const facts = statistics.locator('.work-statistics-facts li');
  // As shown: each value's description is for assistive technology.
  await expect(facts).toHaveText(['4 h 8 min of agent time', (await compact(window, 13815500)) + ' tokens'], { useInnerText: true });
  await expect(window.locator('.about')).not.toContainText('Recent activity');
  await expect(window.locator('.about')).not.toContainText('active/0001-saved-payment-methods', { timeout: 1000 });
  // Where the About sidebar sits below the plan, the plan arriving moves it: hover once it has.
  await expect(window.locator('.reader .prose h2').first()).toBeVisible();
  await facts.nth(0).locator('.detailed').hover();
  await expect(window.locator('.env-tooltip')).toContainText('Measured from logs2 h 38 min');
  await expect(window.locator('.env-tooltip')).toContainText('Estimated from reports1 h 30 min');
  await expect(window.locator('.env-tooltip')).toContainText('Since ');
  await window.mouse.move(0, 0);
  await expect(window.locator('.env-tooltip')).toHaveCount(0);
  await facts.nth(0).locator('.detailed').focus();
  await expect(facts.nth(0).locator('.detailed')).toHaveAccessibleDescription(/measured from the agent's session logs/);

  // The plan's statistics page, a place in the history: its headline figures, and time and tokens by model and effort.
  await statistics.getByRole('link', { name: 'All statistics and the timeline' }).click();
  await expect(window.locator('.plan-statistics-page h1')).toHaveText('Statistics');
  await expect(window.locator('.plan-statistics-page .stat', { hasText: 'Agent time' }).locator('.stat-value')).toHaveText('4 h 8 min');
  await expect(window.getByRole('table', { name: 'Agent time and tokens by model and effort' })).toContainText('Claude Opus 5.5');
  await expect(window.getByRole('table', { name: 'Agent time and tokens by stage' })).toHaveCount(0);
  await window.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
});
