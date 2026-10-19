import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { addProject, applicationMenu, close, expectHub, fileMenu, filterHub, goHome, launchProject, openDocument, openPlan, pageScroll, projectHome, removeDirectory, searchPopup, settledScroll, showFiles, shownFile, type Launched } from './app';

let launched: (Launched & { folder: string }) | undefined;
const homes: string[] = [];
test.afterEach(async () => { await close(launched); launched = undefined; for (const home of homes.splice(0)) removeDirectory(home); });

/** What the window shows: the hub, a work item, a file or a diagram. */
const shows = (window: Page) => window.locator('.hub h1, .work-header h1, .file-page .work-trail [aria-current="page"], .model-picker-title').first();
/** The last step of a work item's trail: its number. */
const trailEnd = (window: Page) => window.locator('.work-main .breadcrumb [aria-current="page"]');
/** Shows the work item Saved payment methods (#0001), or Customer order notifications (#0003). */
async function showsPlan(window: Page, plan: 'payments' | 'notifications') {
  await expect(shows(window)).toHaveText(plan === 'payments' ? 'Saved payment methods' : 'Customer order notifications');
  await expect(trailEnd(window)).toHaveText(plan === 'payments' ? '#0001' : '#0003');
}

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

test('back and forward step through the hub, two plans and a diagram', async () => {
  launched = await launchProject();
  const { window, app } = launched;
  const back = window.getByRole('button', { name: 'Back' });
  const forward = window.getByRole('button', { name: 'Forward' });
  await expect(back).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowLeft BrowserBack');
  await expect(forward).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowRight BrowserForward');
  await expect(back).toHaveAttribute('aria-disabled', 'true');

  // The hub, then a plan, another plan from the search, and a diagram.
  await openPlan(window, 'Saved payment methods');
  await showsPlan(window, 'payments');
  await window.keyboard.press('Control+P');
  const palette = searchPopup(window);
  await palette.getByRole('combobox').fill('Customer order notifications');
  await expect(palette.getByRole('option').first()).toContainText('Customer order notifications');
  await palette.getByRole('combobox').press('Enter');
  await showsPlan(window, 'notifications');
  await window.keyboard.press('Control+P');
  await palette.getByRole('combobox').fill('Checkout · proposed payment methods');
  await expect(palette.getByRole('option').first()).toContainText('Checkout · proposed payment methods');
  await palette.getByRole('combobox').press('Enter');
  await expect(shows(window)).toHaveText('Checkout · proposed payment methods');
  await expect(back).not.toHaveAttribute('aria-disabled', 'true');
  await expect(forward).toHaveAttribute('aria-disabled', 'true');

  // Back: the title bar's arrow, Alt+←, and View › Back of the application menu.
  await back.click();
  await showsPlan(window, 'notifications');
  await window.keyboard.press('Alt+ArrowLeft');
  await showsPlan(window, 'payments');
  // Alt+← leaves the menu alone: no menu opens.
  await expect(window.getByRole('menu')).toHaveCount(0);
  // (The same key's echo from the application menu, a moment later, is ignored.)
  await window.waitForTimeout(400);
  await applicationMenu(app, '&View', '&Back');
  await expectHub(window);
  await expect(back).toHaveAttribute('aria-disabled', 'true');
  // At the end of the history the arrow stays focusable and keeps focus.
  await back.focus();
  await window.keyboard.press('Enter');
  await expectHub(window);
  await expect(back).toBeFocused();

  // Forward and back: the application menu's View › Forward, the mouse's buttons, Alt+→ and the arrow.
  await applicationMenu(app, '&View', '&Forward');
  await showsPlan(window, 'payments');
  await window.waitForTimeout(400);
  expect(await mouseButton(window, 4)).toBe(true);
  await showsPlan(window, 'notifications');
  expect(await mouseButton(window, 3)).toBe(true);
  await showsPlan(window, 'payments');
  await window.keyboard.press('Alt+ArrowRight');
  await showsPlan(window, 'notifications');
  await forward.click();
  await expect(shows(window)).toHaveText('Checkout · proposed payment methods');
  await expect(forward).toHaveAttribute('aria-disabled', 'true');

  // Showing something new drops what was ahead.
  await back.click();
  await showsPlan(window, 'notifications');
  await goHome(window);
  await expect(forward).toHaveAttribute('aria-disabled', 'true');

  // In a narrow window the arrows stay clear of the menu.
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setContentSize(640, 600); });
  // The window's minimum size can keep it a few pixels wider than asked.
  await expect.poll(() => window.evaluate(() => innerWidth)).toBeLessThan(700);
  const menu = (await fileMenu(window).boundingBox())!;
  const arrow = (await forward.boundingBox())!;
  expect(arrow.x + arrow.width).toBeLessThanOrEqual(menu.x);
});

test('a long plan scrolls below the title bar, going back finds it where it was left, and fields and the file panel keep their part', async () => {
  launched = await launchProject();
  const { window, app } = launched;
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(900, 480); });
  await openPlan(window, 'Saved payment methods');
  await window.locator('.work-main').hover();
  await window.mouse.wheel(0, 500);
  let position = -1;
  await expect.poll(async () => {
    const top = await pageScroll(window);
    const steady = top > 0 && Math.abs(top - position) < 0.5;
    position = top;
    return steady;
  }, { intervals: [150] }).toBe(true);
  // The content scrolls, not the window: the title bar stays.
  await expect(window.locator('.env-title-bar')).toBeInViewport();
  expect(await window.evaluate(() => document.scrollingElement!.scrollHeight > document.scrollingElement!.clientHeight)).toBe(false);

  // To the hub and back: the plan is where it was.
  await goHome(window);
  await window.keyboard.press('Alt+ArrowLeft');
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await expect.poll(async () => Math.abs(await pageScroll(window) - position)).toBeLessThan(2);

  // A field keeps Alt+← (the hub's search field, focus back in it once the search closes); the
  // application menu's fallback for that key is ignored too.
  await window.keyboard.press('Alt+ArrowRight');
  await expectHub(window);
  const field = window.getByRole('searchbox', { name: 'Search' });
  await field.click();
  await window.keyboard.press('Escape');
  await expect(searchPopup(window)).toHaveCount(0);
  await expect(field).toBeFocused();
  await window.keyboard.press('Alt+ArrowLeft');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu:command', 'goBack'));
  await window.waitForTimeout(400);
  await expectHub(window);
  await expect(field).toBeFocused();
  // So does the search's own field, which keeps its keys to itself.
  await window.keyboard.press('Control+P');
  const search = searchPopup(window).getByRole('combobox');
  await expect(search).toBeFocused();
  await window.keyboard.press('Alt+ArrowLeft');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu:command', 'goBack'));
  await window.waitForTimeout(400);
  await expectHub(window);
  await expect(search).toBeFocused();
  await window.keyboard.press('Escape');

  // A file chosen in the Files card opens on the page, the card staying beside it; Alt+← goes back to the plan.
  await openPlan(window, 'Customer order notifications');
  const files = await showFiles(window);
  await files.locator('[role="treeitem"][data-id="f:active/0003-customer-notifications/ledger.md"]').click();
  await expect(shownFile(window)).toHaveText('ledger.md');
  await expect(files.locator('[role="treeitem"][data-id="f:active/0003-customer-notifications/ledger.md"]')).toHaveAttribute('aria-selected', 'true');
  await window.keyboard.press('Alt+ArrowLeft');
  await expect(window.locator('.work-header h1')).toHaveText('Customer order notifications');
});

test('a link into a sibling project in the home opens there; one to a folder no project has is unavailable', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  const coord = addProject(home.dataDirectory, 'coord', 'Coord');
  const plan = path.join(coord, 'active/0001-saved-payment-methods/plan.md');
  writeFileSync(plan, readFileSync(plan, 'utf8') + '\n## Elsewhere\n\nSee [the fulfilment model](../../../northwind/active/0002-order-fulfilment-model/plan.md) and [nothing](../../../nowhere/README.md).\n');
  launched = await launchProject(home);
  const { window } = launched;
  await filterHub(window, 'Coord');
  await openPlan(window, 'Saved payment methods');
  await expect(window.locator('.work-main .breadcrumb')).toContainText('Coord');
  await expect(window.locator('.prose .outside-reference', { hasText: 'nothing' })).toBeVisible();
  await window.locator('.prose').getByRole('link', { name: 'the fulfilment model' }).click();
  await expect(window.locator('.work-header h1')).toHaveText('Order fulfilment model');
  // A place of that project: the Files card shows that plan's files.
  await expect(window.locator('.work-main .breadcrumb')).toContainText('Northwind');
  await expect((await showFiles(window)).locator('[role="treeitem"][data-id="f:active/0002-order-fulfilment-model/plan.md"]')).toBeVisible();
});

test('going back finds a document where it was before a jump to one of its headings, and one read on from there keeps its reading place', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  writeFileSync(path.join(home.folder, 'knowledge', 'shop', 'jump.md'), '# Jump\n\nSee [the current checkout](../../active/0001-saved-payment-methods/plan.md#current-checkout).\n');
  launched = await launchProject(home);
  const { window, app } = launched;
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(900, 480); });
  await openPlan(window, 'Saved payment methods');
  await window.locator('.work-main').hover();
  for (let index = 0; index < 6; index++) await window.mouse.wheel(0, 1500);
  const before = await settledScroll(window);
  expect(before).toBeGreaterThan(500);
  // A file links to one of the plan's headings; the plan opens there.
  await openDocument(window, 'jump.md');
  await window.getByRole('link', { name: 'the current checkout' }).click();
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  const atHeading = await settledScroll(window);
  expect(Math.abs(atHeading - before)).toBeGreaterThan(100);
  // Back to the file, then back to the plan as it was before the jump.
  await window.locator('body').press('Alt+ArrowLeft');
  await expect(shownFile(window)).toContainText('jump.md');
  await window.locator('body').press('Alt+ArrowLeft');
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await expect.poll(async () => Math.abs(await settledScroll(window) - before)).toBeLessThan(2);

  // The jump again, then reading on from the heading, then the hub and the plan again from there:
  // it opens at the reading place.
  await window.locator('body').press('Alt+ArrowRight');
  await expect(shownFile(window)).toContainText('jump.md');
  await window.getByRole('link', { name: 'the current checkout' }).click();
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  const again = await settledScroll(window);
  await window.locator('.work-main').hover();
  for (let index = 0; index < 3; index++) await window.mouse.wheel(0, 700);
  const reading = await settledScroll(window);
  expect(reading - again).toBeGreaterThan(300);
  await goHome(window);
  await openPlan(window, 'Saved payment methods');
  await expect.poll(async () => Math.abs(await settledScroll(window) - reading)).toBeLessThan(2);
  // Back to the hub, then to the plan where it was left before it.
  await window.locator('body').press('Alt+ArrowLeft');
  await expect(shows(window)).toHaveText('Plans');
  await window.locator('body').press('Alt+ArrowLeft');
  await expect(shows(window)).toHaveText('Saved payment methods');
  await expect.poll(async () => Math.abs(await settledScroll(window) - reading)).toBeLessThan(2);
});

test('the mouse buttons close an open menu without going back, and one press goes one step however it arrives', async () => {
  launched = await launchProject();
  const { window, app } = launched;
  await openPlan(window, 'Saved payment methods');
  // A decision the plan links.
  const decision = '0001-acquirer-tokens-only.md';
  await window.locator('.prose').getByRole('link', { name: 'ADR 0001' }).click();
  await expect(shows(window)).toHaveText(decision);
  await window.keyboard.press('Alt+ArrowLeft');
  await expect(shows(window)).toHaveText('Saved payment methods');
  await window.locator('.diagram-card').first().getByRole('button', { name: 'Open diagram' }).click();
  await expect(window.locator('.diagrams .node').first()).toBeVisible();
  const diagram = (await window.locator('.model-picker-title').textContent())!;
  // Windows and Linux report the buttons to the window too, as main's back or forward.
  const windowReports = (command: 'browser-backward' | 'browser-forward') => app.evaluate(({ BrowserWindow }, name) => { BrowserWindow.getAllWindows()[0].emit('app-command', {}, name); }, command);

  // A menu open as the button goes down: the press only closes it, also when the window reports it.
  await fileMenu(window).click();
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
  await windowReports('browser-forward');
  expect(await mouseButton(window, 4)).toBe(true);
  await expect(shows(window)).toHaveText(diagram);
  await window.waitForTimeout(400);
  await expect(shows(window)).toHaveText(diagram);

  // Over the title bar's empty space only the window gets the press.
  await windowReports('browser-backward');
  await expect(shows(window)).toHaveText('Saved payment methods');
  await windowReports('browser-forward');
  await expect(shows(window)).toHaveText(diagram);
});
