import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { close, launchProject, projectHome, removeDirectory, showFiles, type Launched } from './app';

let launched: (Launched & { folder: string }) | undefined;
const homes: string[] = [];
test.afterEach(async () => { await close(launched); launched = undefined; for (const home of homes.splice(0)) removeDirectory(home); });

const tabs = (window: Page) => window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
const previewTabs = (window: Page) => window.getByRole('tablist', { name: 'Open tabs' }).locator('[role="tab"][data-preview="true"]');
const activeTab = (window: Page) => window.getByRole('tablist', { name: 'Open tabs' }).locator('[role="tab"][aria-selected="true"]');
/** What the window shows: the project's page, a plan, the ledger or a diagram. */
const shows = (window: Page) => window.locator('.project-page h1, .work-header h1, .reader-name strong, .model-picker-title').first();
const menubar = (window: Page) => window.getByRole('menubar', { name: 'Application menu' });

/** The mouse's back (3) or forward (4) button, pressed and released over the page; true when the release was taken. */
function mouseButton(window: Page, button: 3 | 4) {
  return window.evaluate(pressed => {
    const target = document.elementFromPoint(innerWidth / 2, innerHeight / 2) ?? document.body;
    const init = { button: pressed, bubbles: true, cancelable: true, composed: true, clientX: innerWidth / 2, clientY: innerHeight / 2 };
    target.dispatchEvent(new MouseEvent('mousedown', init));
    const released = target.dispatchEvent(new MouseEvent('mouseup', init));
    target.dispatchEvent(new MouseEvent('auxclick', init));
    return !released;
  }, button);
}

/** The content area's scroll position once it has settled. */
async function settledScroll(window: Page) {
  let position = -1;
  await expect.poll(async () => {
    const top = await window.evaluate(() => document.querySelector('main')!.scrollTop);
    const steady = Math.abs(top - position) < 0.5;
    position = top;
    return steady;
  }, { intervals: [200] }).toBe(true);
  return position;
}

test('back and forward step through a project\'s page, a plan, its ledger and a diagram', async () => {
  launched = await launchProject();
  const { window, app } = launched;
  const back = window.getByRole('button', { name: 'Back' });
  const forward = window.getByRole('button', { name: 'Forward' });
  // The arrows sit between the menus and the computer.
  const left = async (target: ReturnType<Page['locator']>) => (await target.boundingBox())!.x;
  const order = [await left(menubar(window)), await left(back), await left(forward), await left(window.getByRole('button', { name: /^Computer:/ }))];
  expect(order).toEqual([...order].sort((a, b) => a - b));
  await expect(back).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowLeft BrowserBack');
  await expect(forward).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowRight BrowserForward');

  // The project's page, then a work item's plan, its ledger, and a diagram.
  await window.locator('.work-row a', { hasText: 'Saved payment methods' }).click({ modifiers: ['Control'] });
  await expect(shows(window)).toHaveText('Saved payment methods');
  await window.locator('.about').getByRole('link', { name: 'Ledger' }).click({ modifiers: ['Control'] });
  await expect(shows(window)).toHaveText('ledger.md');
  await window.keyboard.press('Control+P');
  const palette = window.getByRole('dialog', { name: 'Quick open' });
  await palette.getByRole('combobox').fill('Checkout · proposed payment methods');
  await expect(palette.getByRole('option').first()).toContainText('Checkout · proposed payment methods');
  await palette.getByRole('combobox').press('Control+Enter');
  await expect(shows(window)).toHaveText('Checkout · proposed payment methods');
  await expect(back).toBeEnabled();
  await expect(forward).toBeDisabled();

  // Back: the title bar's arrow, Alt+←, the mouse's back button and View › Back.
  await back.click();
  await expect(shows(window)).toHaveText('ledger.md');
  await window.keyboard.press('Alt+ArrowLeft');
  await expect(shows(window)).toHaveText('Saved payment methods');
  // Alt+← leaves the menubar alone: no menu opens and the menus do not take focus.
  await expect(window.getByRole('menu')).toHaveCount(0);
  expect(await window.evaluate(() => Boolean(document.activeElement?.closest('[role="menubar"]')))).toBe(false);
  expect(await mouseButton(window, 3)).toBe(true);
  await expect(shows(window)).toHaveText('Northwind');
  await expect(back).toBeEnabled();
  await menubar(window).getByRole('menuitem', { name: 'View' }).click();
  await expect(window.getByRole('menuitem', { name: 'Back' })).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowLeft');
  await window.getByRole('menuitem', { name: 'Back' }).click();
  await expect(window.getByRole('heading', { name: 'Open a project' })).toBeVisible();
  await expect(window.getByRole('menu')).toHaveCount(0);
  await expect(back).toBeDisabled();
  // The tabs stay open while nothing shows.
  await expect(tabs(window)).toHaveCount(4);

  // Forward: the application menu's View › Forward, Alt+→, the mouse's forward button and the arrow.
  await app.evaluate(({ Menu }) => {
    const view = Menu.getApplicationMenu()!.items.find(entry => entry.label === '&View')!;
    view.submenu!.items.find(item => item.label === '&Forward')!.click();
  });
  await expect(shows(window)).toHaveText('Northwind');
  await window.keyboard.press('Alt+ArrowRight');
  await expect(shows(window)).toHaveText('Saved payment methods');
  expect(await mouseButton(window, 4)).toBe(true);
  await expect(shows(window)).toHaveText('ledger.md');
  await forward.click();
  await expect(shows(window)).toHaveText('Checkout · proposed payment methods');
  await expect(forward).toBeDisabled();

  // Showing something new drops what was ahead.
  await back.click();
  await expect(shows(window)).toHaveText('ledger.md');
  await tabs(window).filter({ hasText: 'Northwind' }).click();
  await expect(forward).toBeDisabled();
});

test('going back reopens a closed tab as a preview at its place, and fields and the file panel keep their part', async () => {
  launched = await launchProject();
  const { window, app } = launched;
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(900, 480); });
  const scrollTop = () => window.evaluate(() => document.querySelector('main')!.scrollTop);
  // Opened and kept, then scrolled.
  await window.locator('.work-row a', { hasText: 'Saved payment methods' }).click({ modifiers: ['Control'] });
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await expect(previewTabs(window)).toHaveCount(0);
  await window.locator('.work-main').hover();
  await window.mouse.wheel(0, 500);
  let position = -1;
  await expect.poll(async () => {
    const top = await scrollTop();
    const steady = top > 0 && Math.abs(top - position) < 0.5;
    position = top;
    return steady;
  }, { intervals: [150] }).toBe(true);

  // Closing the tab shows the project's page; going back opens it again, as a preview, where it was.
  await window.keyboard.press('Control+W');
  await expect(tabs(window)).toHaveCount(1);
  await expect(window.locator('.work-row')).toHaveCount(3);
  await window.keyboard.press('Alt+ArrowLeft');
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await expect(previewTabs(window)).toHaveCount(1);
  await expect.poll(async () => Math.abs(await scrollTop() - position)).toBeLessThan(2);

  // A field keeps Alt+←; the application menu's fallback for that key is ignored too.
  await window.keyboard.press('Alt+ArrowRight');
  await expect(window.locator('.work-row')).toHaveCount(3);
  const search = window.getByLabel('Search work');
  await search.click();
  await window.keyboard.press('Alt+ArrowLeft');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu:command', 'goBack'));
  await window.waitForTimeout(400);
  await expect(window.locator('.work-row')).toHaveCount(3);
  await expect(search).toBeFocused();

  // In the file panel, Alt+← goes back rather than collapsing the folder.
  const files = await showFiles(window);
  await files.locator('[role="treeitem"][data-id="d:knowledge"]').click();
  await files.locator('[role="treeitem"][data-id="d:knowledge/shop"]').click();
  await files.locator('[role="treeitem"][data-id="f:knowledge/shop/inventory-schema.md"]').click();
  await expect(window.locator('.reader-name')).toContainText('inventory-schema.md');
  await window.keyboard.press('Alt+ArrowLeft');
  await expect(window.locator('.work-row')).toHaveCount(3);
  await expect(files.locator('[role="treeitem"][data-id="d:knowledge/shop"]')).toHaveAttribute('aria-expanded', 'true');
});

test('a work row opens from anywhere on it, and its diagram count opens its first diagram', async () => {
  launched = await launchProject();
  const { window } = launched;
  const row = window.locator('.work-row', { hasText: 'Order fulfilment model' });
  await expect(row).toBeVisible();
  // A press on the row's details, away from its title, opens the work item.
  const detail = (await row.getByText('#0002').boundingBox())!;
  await window.mouse.click(detail.x + detail.width / 2, detail.y + detail.height / 2);
  await expect(window.locator('.work-header h1')).toHaveText('Order fulfilment model');
  // A detail with a tooltip of its own stays above the link, so the tooltip shows, and it opens the item too.
  await tabs(window).filter({ hasText: 'Northwind' }).click();
  const updated = row.locator('.work-row-updated');
  await expect(updated).toHaveAttribute('title', /^Updated /);
  const box = (await updated.boundingBox())!;
  expect(await window.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.work-row-updated')), { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toBe(true);
  await updated.click();
  await expect(window.locator('.work-header h1')).toHaveText('Order fulfilment model');
  // A press that moves a little does not drag the title link away.
  await tabs(window).filter({ hasText: 'Northwind' }).click();
  await expect(row.getByRole('link', { name: 'Order fulfilment model' })).toHaveAttribute('draggable', 'false');
  await tabs(window).filter({ hasText: 'Northwind' }).click();
  await row.locator('.diagram-count').click();
  await expect(window.locator('.model-picker-title')).toBeVisible();
  // One link names the row for the keyboard and screen readers.
  await tabs(window).filter({ hasText: 'Northwind' }).click();
  await expect(row.getByRole('link')).toHaveText(['Order fulfilment model', /2/]);
});

test('going back finds a document where it was before a jump to one of its headings', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  writeFileSync(path.join(home.folder, 'knowledge', 'shop', 'jump.md'), '# Jump\n\nSee [the current checkout](../../active/0001-saved-payment-methods/plan.md#current-checkout).\n');
  launched = await launchProject(home);
  const { window, app } = launched;
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(900, 480); });
  await window.locator('.work-row a', { hasText: 'Saved payment methods' }).click({ modifiers: ['Control'] });
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await window.locator('.work-main').hover();
  for (let index = 0; index < 6; index++) await window.mouse.wheel(0, 1500);
  const before = await settledScroll(window);
  expect(before).toBeGreaterThan(500);
  // A file links to one of the plan's headings; the plan opens there.
  const files = await showFiles(window);
  await files.locator('[role="treeitem"][data-id="d:knowledge"]').click();
  await files.locator('[role="treeitem"][data-id="d:knowledge/shop"]').click();
  await files.locator('[role="treeitem"][data-id="f:knowledge/shop/jump.md"]').click();
  await window.keyboard.press('Control+Shift+E');
  await expect(window.locator('.reader-name')).toContainText('jump.md');
  await window.getByRole('link', { name: 'the current checkout' }).click();
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  const atHeading = await settledScroll(window);
  expect(Math.abs(atHeading - before)).toBeGreaterThan(100);
  // Back to the file, then back to the plan as it was before the jump.
  await window.locator('body').press('Alt+ArrowLeft');
  await expect(window.locator('.reader-name')).toContainText('jump.md');
  await window.locator('body').press('Alt+ArrowLeft');
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await expect.poll(async () => Math.abs(await settledScroll(window) - before)).toBeLessThan(2);
});

test('a document reached at a heading and read on keeps the reading place across a tab switch, and each step back its own', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  writeFileSync(path.join(home.folder, 'knowledge', 'shop', 'jump.md'), '# Jump\n\nSee [the current checkout](../../active/0001-saved-payment-methods/plan.md#current-checkout).\n');
  launched = await launchProject(home);
  const { window, app } = launched;
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(900, 480); });
  const files = await showFiles(window);
  await files.locator('[role="treeitem"][data-id="d:knowledge"]').click();
  await files.locator('[role="treeitem"][data-id="d:knowledge/shop"]').click();
  await files.locator('[role="treeitem"][data-id="f:knowledge/shop/jump.md"]').dblclick();
  await window.keyboard.press('Control+Shift+E');
  await window.getByRole('link', { name: 'the current checkout' }).click({ modifiers: ['Control'] });
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  const atHeading = await settledScroll(window);
  // Read on from the heading, then look at the project's page and come back to the plan.
  await window.locator('.work-main').hover();
  for (let index = 0; index < 3; index++) await window.mouse.wheel(0, 700);
  const reading = await settledScroll(window);
  expect(reading - atHeading).toBeGreaterThan(300);
  await tabs(window).filter({ hasText: 'Northwind' }).click();
  await expect(shows(window)).toHaveText('Northwind');
  await tabs(window).filter({ hasText: 'Saved payment methods' }).click();
  await expect.poll(async () => Math.abs(await settledScroll(window) - reading)).toBeLessThan(2);
  // Back to the project's page, then to the plan where it was left before it.
  await window.locator('body').press('Alt+ArrowLeft');
  await expect(shows(window)).toHaveText('Northwind');
  await window.locator('body').press('Alt+ArrowLeft');
  await expect(shows(window)).toHaveText('Saved payment methods');
  await expect.poll(async () => Math.abs(await settledScroll(window) - reading)).toBeLessThan(2);
});

test('the mouse buttons close an open menu without going back, and one press goes one step however it arrives', async () => {
  launched = await launchProject();
  const { window, app } = launched;
  await window.locator('.work-row a', { hasText: 'Saved payment methods' }).click({ modifiers: ['Control'] });
  await expect(shows(window)).toHaveText('Saved payment methods');
  await window.locator('.about').getByRole('link', { name: 'Ledger' }).click({ modifiers: ['Control'] });
  await expect(shows(window)).toHaveText('ledger.md');
  await tabs(window).filter({ hasText: 'Saved payment methods' }).click();
  await window.locator('.diagram-card').first().getByRole('button', { name: 'Open diagram' }).click();
  await expect(window.locator('.diagrams .node').first()).toBeVisible();
  const diagram = (await window.locator('.model-picker-title').textContent())!;
  // Windows and Linux report the buttons to the window too, as main's back or forward.
  const windowReports = (command: 'browser-backward' | 'browser-forward') => app.evaluate(({ BrowserWindow }, name) => { BrowserWindow.getAllWindows()[0].emit('app-command', {}, name); }, command);

  // A menu open as the button goes down: the press only closes it, also when the window reports it.
  await menubar(window).getByRole('menuitem', { name: 'View' }).click();
  await expect(window.getByRole('menu')).toBeVisible();
  expect(await mouseButton(window, 3)).toBe(true);
  await windowReports('browser-backward');
  await window.waitForTimeout(400);
  await window.keyboard.press('Escape');
  await expect(window.getByRole('menu')).toHaveCount(0);
  await expect(shows(window)).toHaveText(diagram);

  // One press the page and the window both get goes one step, whichever comes first.
  expect(await mouseButton(window, 3)).toBe(true);
  await windowReports('browser-backward');
  await expect(shows(window)).toHaveText('Saved payment methods');
  await window.waitForTimeout(400);
  await expect(shows(window)).toHaveText('Saved payment methods');
  await windowReports('browser-backward');
  expect(await mouseButton(window, 3)).toBe(true);
  await expect(shows(window)).toHaveText('ledger.md');
  await window.waitForTimeout(400);
  await expect(shows(window)).toHaveText('ledger.md');

  // Over the title bar's empty space only the window gets the press: it goes back (to the plan the ledger was opened from).
  await windowReports('browser-backward');
  await expect(shows(window)).toHaveText('Saved payment methods');
  await windowReports('browser-forward');
  await expect(shows(window)).toHaveText('ledger.md');
});

test('in a narrow window the menus stay clear of the arrows, which keep focus at the end of the history', async () => {
  launched = await launchProject();
  const { window, app } = launched;
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setContentSize(640, 600); });
  const help = (await menubar(window).getByRole('menuitem', { name: 'Help' }).boundingBox())!;
  const back = window.getByRole('button', { name: 'Back' });
  const arrow = (await back.boundingBox())!;
  expect(help.x + help.width).toBeLessThanOrEqual(arrow.x);
  // At the end of the history the arrow stays focusable and keeps focus.
  await window.locator('.work-row a', { hasText: 'Saved payment methods' }).click();
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await back.focus();
  await window.keyboard.press('Enter');
  await expect(window.locator('.work-row')).toHaveCount(3);
  await window.keyboard.press('Enter');
  await expect(window.getByRole('heading', { name: 'Open a project' })).toBeVisible();
  await expect(back).toBeDisabled();
  await expect(back).toBeFocused();
});
