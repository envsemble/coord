import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { close, launch, planningFixture, removeDirectory, type Launched } from './app';

let launched: Launched | undefined;
let folder: string;
test.beforeEach(() => { folder = planningFixture(); });
test.afterEach(async () => { await close(launched); launched = undefined; removeDirectory(path.dirname(folder)); });

const views = (window: Page) => window.getByRole('navigation', { name: 'Atlas' });
const tabs = (window: Page) => window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
const previewTabs = (window: Page) => window.getByRole('tablist', { name: 'Open tabs' }).locator('[role="tab"][data-preview="true"]');
/** A work item's sections; one place to change if the section switcher changes. */
const sections = (window: Page) => window.getByRole('radiogroup', { name: 'Work sections' }).getByRole('radio');
const section = (window: Page) => sections(window).and(window.locator('[aria-checked="true"]'));
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

test('back and forward step through pages, a work item and its sections', async () => {
  launched = await launch({ folder });
  const { window, app } = launched;
  await expect(window.locator('.work-row')).toHaveCount(3);
  const back = window.getByRole('button', { name: 'Back' });
  const forward = window.getByRole('button', { name: 'Forward' });
  // The arrows sit between the menus and the computer; a window starts with nowhere to go.
  const left = async (target: ReturnType<Page['locator']>) => (await target.boundingBox())!.x;
  const order = [await left(menubar(window)), await left(back), await left(forward), await left(window.getByRole('button', { name: /^Computer:/ }))];
  expect(order).toEqual([...order].sort((a, b) => a - b));
  await expect(back).toBeDisabled();
  await expect(forward).toBeDisabled();
  await expect(back).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowLeft BrowserBack');
  await expect(forward).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowRight BrowserForward');

  // The Work page, then a work item (on its ledger), its plan and diagrams, then Activity.
  await window.locator('.work-row a', { hasText: 'Saved payment methods' }).click();
  await expect(section(window)).toContainText('Ledger');
  await sections(window).filter({ hasText: 'Plan' }).click();
  await expect(section(window)).toContainText('Plan');
  await sections(window).filter({ hasText: 'Diagrams' }).click();
  await expect(window.locator('.model-picker-title')).toBeVisible();
  await views(window).getByRole('button', { name: 'Activity' }).click();
  await expect(window.locator('.activity-row')).toHaveCount(1);
  await expect(back).toBeEnabled();
  await expect(forward).toBeDisabled();

  // Back: the title bar's arrow, Alt+←, the mouse's back button and View › Back.
  await back.click();
  await expect(section(window)).toContainText('Diagrams');
  await window.keyboard.press('Alt+ArrowLeft');
  await expect(section(window)).toContainText('Plan');
  // Alt+← leaves the menubar alone: no menu opens and the menus do not take focus.
  await expect(window.getByRole('menu')).toHaveCount(0);
  expect(await window.evaluate(() => Boolean(document.activeElement?.closest('[role="menubar"]')))).toBe(false);
  expect(await mouseButton(window, 3)).toBe(true);
  await expect(section(window)).toContainText('Ledger');
  await menubar(window).getByRole('menuitem', { name: 'View' }).click();
  await expect(window.getByRole('menuitem', { name: 'Back' })).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowLeft');
  await window.getByRole('menuitem', { name: 'Back' }).click();
  await expect(window.locator('.work-row')).toHaveCount(3);
  await expect(window.getByRole('menu')).toHaveCount(0);
  await expect(back).toBeDisabled();
  // The tab stays open while its page shows.
  await expect(tabs(window)).toHaveCount(1);

  // Forward: the application menu's View › Forward, Alt+→, the mouse's forward button and the arrow.
  await app.evaluate(({ Menu }) => {
    const view = Menu.getApplicationMenu()!.items.find(entry => entry.label === '&View')!;
    view.submenu!.items.find(item => item.label === '&Forward')!.click();
  });
  await expect(section(window)).toContainText('Ledger');
  await window.keyboard.press('Alt+ArrowRight');
  await expect(section(window)).toContainText('Plan');
  expect(await mouseButton(window, 4)).toBe(true);
  await expect(section(window)).toContainText('Diagrams');
  await forward.click();
  await expect(window.locator('.activity-row')).toHaveCount(1);
  await expect(forward).toBeDisabled();

  // Showing something new drops what was ahead.
  await back.click();
  await expect(section(window)).toContainText('Diagrams');
  await views(window).getByRole('button', { name: 'Statistics' }).click();
  await expect(forward).toBeDisabled();
});

test('going back reopens a closed tab as a preview at its place, and fields and the explorer keep their part', async () => {
  launched = await launch({ folder });
  const { window, app } = launched;
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(900, 480); });
  await expect(window.locator('.work-row')).toHaveCount(3);
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

  // Closing the tab shows the page; going back opens it again, as a preview, where it was.
  await window.keyboard.press('Control+W');
  await expect(tabs(window)).toHaveCount(0);
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

  // In the explorer, Alt+← goes back rather than collapsing the folder.
  await window.locator('[role="treeitem"][data-id="d:knowledge"]').click();
  await window.locator('[role="treeitem"][data-id="d:knowledge/shop"]').click();
  await window.locator('[role="treeitem"][data-id="f:knowledge/shop/inventory-schema.md"]').click();
  await expect(window.locator('.reader-name')).toContainText('inventory-schema.md');
  await window.keyboard.press('Alt+ArrowLeft');
  await expect(window.locator('.work-row')).toHaveCount(3);
  await expect(window.locator('[role="treeitem"][data-id="d:knowledge/shop"]')).toHaveAttribute('aria-expanded', 'true');
});

test('a work row opens from anywhere on it, and its diagram count opens its diagrams', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  const row = window.locator('.work-row', { hasText: 'Order fulfilment model' });
  await expect(row).toBeVisible();
  // A press on the row's details, away from its title, opens the work item.
  const detail = (await row.getByText('#0002').boundingBox())!;
  await window.mouse.click(detail.x + detail.width / 2, detail.y + detail.height / 2);
  await expect(window.locator('.work-header h1')).toHaveText('Order fulfilment model');
  await views(window).getByRole('button', { name: /^Work/ }).click();
  await row.locator('.diagram-count').click();
  await expect(section(window)).toContainText('Diagrams');
  await expect(window.locator('.model-picker-title')).toBeVisible();
  // One link names the row for the keyboard and screen readers.
  await views(window).getByRole('button', { name: /^Work/ }).click();
  await expect(row.getByRole('link')).toHaveText(['Order fulfilment model', /1/]);
});
