// Work statistics from agent reports (fixtures/reports.json, recorded in the home's database as the
// fixture's project is made) and Git: the Statistics page, opened from the menu for one project at
// a time, the side column of a work item and its own statistics page. The fixture has an
// unmeasured planning session, a Claude Code implementation session measured with a subagent, and a
// measured Codex one from before stages were recorded.
import { expect, test, type Page } from '@playwright/test';
import { addProject, close, expectHub, goHome, launch, launchProject, openPlan, openProjectStatistics, pageScroll, projectHome, removeDirectory, settledScroll, type Launched } from './app';

let launched: Launched | undefined;
/** Numbers as the window formats them, whatever the system locale. */
const compact = (window: import('@playwright/test').Page, value: number) => window.evaluate(number => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(number), value);
const whole = (window: import('@playwright/test').Page, value: number) => window.evaluate(number => number.toLocaleString(), value);
const homes: string[] = [];
test.afterEach(async () => { await close(launched); launched = undefined; for (const home of homes.splice(0)) removeDirectory(home); });
/** A project's statistics, from the hub filtered to it, over all its time (the fixture's reports are of a fixed date). */
async function openStatistics(window: Page, project = 'Northwind') {
  await openProjectStatistics(window, project);
  await window.getByRole('radiogroup', { name: 'Period' }).getByRole('radio', { name: 'All time' }).click();
  await expect(window.getByRole('table', { name: 'Agent time and tokens by model and effort' })).toBeVisible();
}

test('each project has its statistics, from the hub filtered to it, under a breadcrumb back to its plans; a wheel over a table scrolls the page', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  addProject(home.dataDirectory, 'harbor', 'Harbor');
  launched = await launch({ dataDirectory: home.dataDirectory });
  const { window, app } = launched;
  await openStatistics(window, 'Northwind');
  // Another project's: its breadcrumb leads back to its plans, and Back returns to its statistics.
  await openStatistics(window, 'Harbor');
  await window.locator('.statistics-page .breadcrumb').getByRole('button', { name: 'Harbor', exact: true }).click();
  await expectHub(window, 'Harbor');
  await window.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(window.locator('.statistics-page .breadcrumb')).toContainText('Harbor');
  // The hub of every project leads to all plans'.
  await goHome(window);
  await window.locator('.hub').getByRole('button', { name: 'Statistics', exact: true }).click();
  await expect(window.locator('.statistics-page .breadcrumb')).toHaveText(/^Plans.*Statistics$/);
  await window.getByRole('radiogroup', { name: 'Period' }).getByRole('radio', { name: 'All time' }).click();
  await expect(window.locator('.statistics-page .stat').first()).toContainText('Agent time');

  // A wheel over a table scrolls the page.
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setContentSize(1200, 520); });
  await openStatistics(window, 'Harbor');
  const table = window.getByRole('table', { name: 'Agent time and tokens by model and effort' });
  await expect(table.getByRole('row').nth(1)).toBeVisible();
  await table.evaluate(element => element.scrollIntoView({ block: 'center' }));
  const before = await settledScroll(window);
  const delta = before > 300 ? -250 : 250;
  // As far as the page can scroll that way, up to the wheel's step.
  const room = Math.min(100, await window.evaluate(down => { const element = document.querySelector('.env-scaffold-body')!; return down ? element.scrollHeight - element.clientHeight - element.scrollTop : element.scrollTop; }, delta > 0));
  expect(room).toBeGreaterThan(20);
  // A point over the table, within the window.
  const box = (await table.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: Math.min(Math.max(box.y, 140) + 80, box.y + box.height - 10) };
  expect(await window.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('table[aria-label="Agent time and tokens by model and effort"]')), point)).toBe(true);
  await window.mouse.move(point.x, point.y);
  await window.mouse.wheel(0, delta);
  await expect.poll(async () => Math.abs(await pageScroll(window) - before)).toBeGreaterThan(room - 2);
});

test("a project's statistics look back on its work: its figures against the period before, its work over time, where the time went and its models and effort; a work item's sidebar sums up its own", async () => {
  launched = await launchProject();
  const { window } = launched;
  await openProjectStatistics(window);
  // No tabs, no repository filter: one page over a period.
  await expect(window.getByRole('radiogroup', { name: 'Statistics sections' })).toHaveCount(0);
  await expect(window.getByRole('combobox', { name: 'Repository' })).toHaveCount(0);
  await expect(window.getByRole('radiogroup', { name: 'Period' }).getByRole('radio', { name: 'Last 4 weeks' })).toBeChecked();
  await window.getByRole('radiogroup', { name: 'Period' }).getByRole('radio', { name: 'All time' }).click();
  // The figures, all time: nothing before to compare with.
  const agentTime = window.locator('.stats-grid .stat', { hasText: 'Agent time' });
  await expect(agentTime.locator('.stat-note')).toHaveText('since the first report');
  await expect(window.locator('.stats-grid .stat', { hasText: 'Plans completed' }).locator('.stat-value')).toHaveText('1');
  // The work over time, by week, a column saying on hover what it holds.
  const chart = window.getByRole('img', { name: /^Agent time by week/ });
  await expect(chart).toBeVisible();
  await chart.locator('.work-chart-stack').first().hover();
  await expect(window.locator('.work-chart-tip')).toContainText('of agent time');
  // The models and effort with their shares.
  const models = window.getByRole('table', { name: 'Agent time and tokens by model and effort' });
  await expect(models).toContainText('Claude Opus 5.5');
  await expect(models).toContainText('GPT-6.1 Sol');

  // A work item's sidebar keeps the headline (its model, agent time and tokens) with what agent time
  // stands for on hover and focus; its own statistics page has the rest. Recent activity is gone.
  await goHome(window);
  await openPlan(window, 'Saved payment methods');
  const statistics = window.locator('.plan-aside-section', { has: window.locator('h2', { hasText: 'Statistics' }) });
  await expect(statistics.locator('.work-statistics-primary')).toHaveText('Claude Opus 5.5');
  await expect(statistics.locator('.work-statistics-primary .provider-mark')).toHaveAttribute('data-provider', 'anthropic');
  await expect(statistics.locator('.work-statistics-others')).toHaveText('with Claude Sonnet 4.5 and Claude Haiku 5.5');
  const facts = statistics.locator('.work-statistics-facts li');
  // As shown: each value's description is for assistive technology.
  await expect(facts).toHaveText(['4 h 8 min of agent time', (await compact(window, 13815500)) + ' tokens'], { useInnerText: true });
  await expect(window.locator('.plan-aside')).not.toContainText('Recent activity');
  await expect(window.locator('.plan-aside')).not.toContainText('active/0001-saved-payment-methods', { timeout: 1000 });
  // Where the side column sits below the plan, the plan arriving moves it: hover once it has.
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
  await expect(window.locator('.plan-statistics-page .stat', { hasText: 'Agent time' }).locator('.stat-value .detailed')).toHaveText('4 h 8 min');
  await expect(window.getByRole('table', { name: 'Agent time and tokens by model and effort' })).toContainText('Claude Opus 5.5');
  await expect(window.getByRole('table', { name: 'Agent time and tokens by stage' })).toHaveCount(0);
  await window.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(window.locator('.work-page h1')).toHaveText('Saved payment methods');
});
