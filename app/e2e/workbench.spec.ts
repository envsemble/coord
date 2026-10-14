import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { close, launch, planningFixture, removeDirectory, temporaryDirectory, type Launched } from './app';

let launched: Launched | undefined;
let folder: string;
test.beforeEach(() => { folder = planningFixture(); });
const dataFolders: string[] = [];
test.afterEach(async () => { await close(launched); launched = undefined; removeDirectory(path.dirname(folder)); for (const data of dataFolders.splice(0)) removeDirectory(data); });

const row = (id: string) => `[role="treeitem"][data-id="${id}"]`;
const tabs = (window: Page) => window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
const activeTab = (window: Page) => window.getByRole('tablist', { name: 'Open tabs' }).locator('[role="tab"][aria-selected="true"]');
const previewTabs = (window: Page) => window.getByRole('tablist', { name: 'Open tabs' }).locator('[role="tab"][data-preview="true"]');
const sections = (window: Page) => window.getByRole('radiogroup', { name: 'Work sections' }).getByRole('radio');
const views = (window: Page) => window.getByRole('navigation', { name: 'Atlas' });

test('opening a folder from the command line shows its work list in a window named after it', async () => {
  launched = await launch({ folder });
  const { window, app } = launched;
  await expect(window.locator('.work-row')).toHaveCount(3);
  await expect(window.locator('.work-row').first()).toContainText('Customer order notifications');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(item => item.getTitle()))).toEqual(['planning — Atlas']);
  // Work is a page of its own, chosen in the sidebar; tabs are for documents, and none is open yet.
  await expect(views(window).getByRole('button', { name: /^Work/ })).toHaveAttribute('aria-current', 'page');
  await expect(tabs(window)).toHaveCount(0);
  await expect(window.locator('.explorer-title')).toHaveText(/planning/i);
});

test('the title bar holds the menus, the computer and the actions; the views are pages beside the tabs', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await expect(window.locator('.work-row')).toHaveCount(3);
  const menubar = window.getByRole('menubar', { name: 'Application menu' });
  await expect(menubar.getByRole('menuitem')).toHaveText(['File', 'Edit', 'View', 'Help']);
  await expect(window.getByRole('button', { name: /^Computer:/ })).toBeVisible();
  await expect(window.getByRole('button', { name: 'More actions' })).toHaveCount(0);
  // Empty title bar space moves the window; its controls stay clickable.
  const regions = await window.evaluate(() => {
    const region = (element: Element | null) => element ? getComputedStyle(element).getPropertyValue('-webkit-app-region') : null;
    return { bar: region(document.querySelector('.env-app-topbar')), search: region(document.querySelector('.search-button')) };
  });
  expect(regions).toEqual({ bar: 'drag', search: 'no-drag' });

  // File › Open Recent lists this computer's folders, this one checked.
  await menubar.getByRole('menuitem', { name: 'File' }).click();
  await window.getByRole('menuitem', { name: 'Open Recent' }).hover();
  await expect(window.getByRole('menuitemradio', { name: /^planning/ })).toHaveAttribute('aria-checked', 'true');
  await window.keyboard.press('Escape');
  await window.keyboard.press('Escape');
  await expect(window.getByRole('menu')).toHaveCount(0);

  // Alt with a menu's letter opens it from the keyboard.
  await window.keyboard.press('Alt+V');
  await expect(window.getByRole('menu', { name: 'View' })).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(window.getByRole('menu')).toHaveCount(0);

  // Edit acts on the field that had focus before the menu opened.
  const search = window.getByRole('searchbox', { name: 'Search work' }).or(window.getByLabel('Search work'));
  await search.first().fill('fulfil');
  await search.first().selectText();
  await menubar.getByRole('menuitem', { name: 'Edit' }).click();
  await window.getByRole('menuitem', { name: 'Copy' }).click();
  await expect.poll(() => launched!.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('fulfil');
  await search.first().fill('');
  // Paste reads the clipboard, which it may right after a person's click.
  await launched!.app.evaluate(({ clipboard }) => clipboard.writeText('reservation'));
  await search.first().click();
  await menubar.getByRole('menuitem', { name: 'Edit' }).click();
  await window.getByRole('menuitem', { name: 'Paste' }).click();
  await expect(search.first()).toHaveValue('reservation');
  await search.first().fill('');

  // The window buttons, where the system draws them, end above the title bar's line, which runs
  // under them too; zooming in keeps them as tall as the bar above its line.
  const overlay = () => window.evaluate(() => {
    const controls = (navigator as Navigator & { windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect } }).windowControlsOverlay;
    return controls?.visible ? Math.round(controls.getTitlebarAreaRect().height) : null;
  });
  if (await overlay() !== null) {
    const bar = () => window.evaluate(() => document.querySelector('.env-app-topbar')!.getBoundingClientRect().height);
    // The line below the buttons: about one CSS pixel (envUI's hairline).
    const line = async () => await bar() - (await overlay())!;
    expect(await overlay()).toBe(39);
    expect(await line()).toBeGreaterThan(0.5);
    expect(await line()).toBeLessThan(1.5);
    // Zoomed in, the buttons' area stays about 39 CSS pixels tall (the page reports it rounded up)
    // instead of shrinking with the zoom, and the bar keeps its line below it.
    const ratio = () => window.evaluate(() => devicePixelRatio);
    const unzoomed = await ratio();
    await menubar.getByRole('menuitem', { name: 'View' }).click();
    await window.getByRole('menuitem', { name: 'Zoom In' }).click();
    await expect.poll(ratio).toBeGreaterThan(unzoomed);
    await expect.poll(overlay).toBeGreaterThanOrEqual(39);
    expect(await overlay()).toBeLessThanOrEqual(40);
    expect(await line()).toBeGreaterThan(0.5);
    expect(await line()).toBeLessThan(1.5);
    await menubar.getByRole('menuitem', { name: 'View' }).click();
    await window.getByRole('menuitem', { name: 'Actual Size' }).click();
    await expect.poll(overlay).toBe(39);
  }

  // Opening a document gives it a tab; a view shows over the tabs without one, and the tab comes back.
  await window.locator('.work-row a', { hasText: 'Saved payment methods' }).click();
  await expect(tabs(window)).toHaveCount(1);
  await expect(activeTab(window)).toContainText('Saved payment methods');
  await views(window).getByRole('button', { name: 'Activity' }).click();
  await expect(window.locator('.activity-row')).toHaveCount(1);
  await expect(tabs(window)).toHaveCount(1);
  await expect(activeTab(window)).toHaveCount(0);
  await tabs(window).first().click();
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  // Closing the last tab shows the page again.
  await window.keyboard.press('Control+W');
  await expect(tabs(window)).toHaveCount(0);
  await expect(window.locator('.activity-row')).toHaveCount(1);
});

test('File › Close Folder returns the window to the start page', async () => {
  const dataDirectory = temporaryDirectory('atlas-e2e-data-');
  dataFolders.push(dataDirectory);
  launched = await launch({ folder, dataDirectory });
  const { window, app } = launched;
  await expect(window.locator('.work-row')).toHaveCount(3);
  const menubar = window.getByRole('menubar', { name: 'Application menu' });
  // A tab opened just before closing the folder is saved with it, though its save was still pending.
  await window.locator('.work-row a', { hasText: 'Saved payment methods' }).click();
  await expect(tabs(window)).toHaveCount(1);
  await menubar.getByRole('menuitem', { name: 'File' }).click();
  await window.getByRole('menuitem', { name: 'Close Folder' }).click();
  await expect(window.getByRole('heading', { name: 'Atlas', level: 1 })).toBeVisible();
  await expect(window.locator('.folder-rows')).toContainText('planning');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(item => item.getTitle()))).toEqual(['Atlas']);
  // The start page has the title bar too, where Close Folder has nothing to close.
  await menubar.getByRole('menuitem', { name: 'File' }).click();
  await expect(window.getByRole('menuitem', { name: 'Close Folder' })).toHaveAttribute('aria-disabled', 'true');
  await window.keyboard.press('Escape');
  // Opening the folder again brings its tab back.
  await window.locator('.folder-rows').getByRole('button', { name: /^planning/ }).click();
  await expect(tabs(window)).toHaveCount(1);
  await expect(activeTab(window)).toContainText('Saved payment methods');
});

test('the explorer mirrors the folder: work folders show status and title, and diagram files open as diagrams', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await expect(window.locator(row('d:active'))).toBeVisible();
  await expect(window.locator('[role="treeitem"]', { hasText: '.atlas' })).toHaveCount(0);
  await window.locator(row('d:active')).click();
  const work = window.locator(row('d:active/0001-saved-payment-methods'));
  await expect(work).toContainText('0001-saved-payment-methods');
  await expect(work).toContainText('Saved payment methods');
  await expect(work.locator('.status-icon')).toHaveAttribute('aria-label', 'In progress');

  // Clicking a work folder expands it and opens its overview in a preview tab.
  await work.click();
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await expect(previewTabs(window)).toContainText('Saved payment methods');
  await window.locator(row('d:active/0001-saved-payment-methods/diagrams')).click();
  const diagram = window.locator(row('f:active/0001-saved-payment-methods/diagrams/checkout-proposal.puml'));
  await expect(diagram).toContainText('checkout-proposal.puml');

  // A diagram file opens the Diagrams view focused on it, in the same (still preview) work tab.
  await diagram.click();
  await expect(window.locator('.model-picker-title')).toHaveText('Checkout · proposed payment methods');
  await expect(sections(window).and(window.locator('[aria-checked="true"]'))).toContainText('Diagrams');

  // A file opens in its own tab, replacing the preview.
  await window.locator(row('f:active/0001-saved-payment-methods/CONTEXT.md')).click();
  await expect(tabs(window)).toHaveCount(1);
  await expect(previewTabs(window)).toContainText('CONTEXT.md');
  await expect(window.locator('.reader-name')).toContainText('CONTEXT.md');
  await expect(window.locator('.prose h1, .prose h2').first()).toBeVisible();
});

test('tabs: single click previews, double click pins, Ctrl+W closes; tabs and sidebar persist per folder', async () => {
  const dataDirectory = temporaryDirectory('atlas-e2e-data-');
  dataFolders.push(dataDirectory);
  launched = await launch({ folder, dataDirectory });
  let { window } = launched;
  await window.locator(row('d:knowledge')).click();
  await window.locator(row('d:knowledge/shop')).click();
  await window.locator(row('f:knowledge/shop/inventory-schema.md')).click();
  await expect(previewTabs(window)).toContainText('inventory-schema.md');
  await window.locator(row('f:knowledge/shop/payments-constraints.md')).click();
  await expect(tabs(window)).toHaveCount(1);
  await expect(previewTabs(window)).toContainText('payments-constraints.md');
  await window.locator(row('f:knowledge/shop/payments-constraints.md')).dblclick();
  await expect(previewTabs(window)).toHaveCount(0);
  await window.locator(row('f:knowledge/shop/inventory-schema.md')).click();
  await expect(tabs(window)).toHaveCount(2);
  await window.keyboard.press('Control+W');
  await expect(tabs(window)).toHaveCount(1);
  await expect(activeTab(window)).toContainText('payments-constraints.md');

  // Ctrl+B collapses the sidebar to its icons, hiding the explorer (a pointer over it would expand it
  // again, as envUI's shell does); the sidebar's edge resizes it.
  await window.mouse.move(900, 400);
  await window.keyboard.press('Control+B');
  await expect(window.locator('.explorer')).toBeHidden();
  await window.keyboard.press('Control+B');
  await expect(window.locator('.explorer')).toBeVisible();
  const divider = window.getByRole('separator', { name: /sidebar/i });
  await divider.focus();
  await window.keyboard.press('ArrowRight');
  await window.keyboard.press('ArrowRight');
  const width = Number(await divider.getAttribute('aria-valuenow'));
  expect(width).toBe(312);
  await window.waitForTimeout(600);
  await close(launched);

  launched = await launch({ dataDirectory });
  window = launched.window;
  await expect(tabs(window)).toHaveCount(1);
  await expect(activeTab(window)).toContainText('payments-constraints.md');
  await expect(window.getByRole('separator', { name: /sidebar/i })).toHaveAttribute('aria-valuenow', '312');
  await expect(window.locator(row('f:knowledge/shop/payments-constraints.md'))).toHaveAttribute('aria-selected', 'true');
});

test('a long document scrolls the window below the tabs, and each tab keeps its position', async () => {
  launched = await launch({ folder });
  const { window, app } = launched;
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(900, 480); });
  await window.locator('.work-row a', { hasText: 'Saved payment methods' }).click();
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await expect.poll(() => window.evaluate(() => globalThis.innerHeight)).toBeLessThanOrEqual(480);
  const sizes = await window.evaluate(() => {
    const page = document.querySelector('main')!;
    return {
      window: globalThis.innerHeight,
      explorerBottom: document.querySelector('.explorer')!.getBoundingClientRect().bottom,
      visible: page.clientHeight,
      content: page.scrollHeight,
      scrollbar: page.offsetWidth - page.clientWidth,
      pageTop: page.getBoundingClientRect().top,
      titleBar: document.querySelector('.env-app-topbar')!.getBoundingClientRect().bottom,
      documentScrolls: document.scrollingElement!.scrollHeight > document.scrollingElement!.clientHeight,
    };
  });
  // The sidebar ends inside the window, and the plan overflows the content area, which scrolls below
  // the title bar with its own scrollbar (so the window buttons never cover it); the document does not.
  expect(sizes.explorerBottom).toBeLessThanOrEqual(sizes.window + 1);
  expect(sizes.content).toBeGreaterThan(sizes.visible);
  expect(sizes.scrollbar).toBeGreaterThan(0);
  expect(sizes.pageTop).toBeGreaterThanOrEqual(sizes.titleBar - 1);
  expect(sizes.documentScrolls).toBe(false);
  const scrollTop = () => window.evaluate(() => document.querySelector('main')!.scrollTop);
  await window.locator('.work-main').hover();
  await window.mouse.wheel(0, 600);
  await expect.poll(scrollTop).toBeGreaterThan(0);
  // The tabs and the work item's sections stay in view under the title bar.
  await expect(window.getByRole('tablist', { name: 'Open tabs' })).toBeInViewport();
  await expect(window.getByRole('radiogroup', { name: 'Work sections' })).toBeInViewport();
  // Wheel scrolling animates: wait until the position settles.
  const settled = async () => {
    let previous = -1;
    await expect.poll(async () => {
      const top = await scrollTop();
      const steady = Math.abs(top - previous) < 0.5;
      previous = top;
      return steady;
    }, { intervals: [100] }).toBe(true);
    return previous;
  };
  const position = await settled();

  // Switching to a page and back keeps each tab's scroll position, though the plan loads again after the switch.
  await views(window).getByRole('button', { name: /^Work/ }).click();
  await expect(window.locator('.work-row').first()).toBeVisible();
  await expect.poll(scrollTop).toBe(0);
  await tabs(window).filter({ hasText: 'Saved payment methods' }).click();
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await expect.poll(async () => Math.abs(await scrollTop() - position)).toBeLessThan(1);

  // Another section of the same tab starts at the top.
  await sections(window).filter({ hasText: 'Plan' }).click();
  await expect.poll(scrollTop).toBe(0);
});

test('the page a window opens on keeps its scroll position when another page or tab is shown', async () => {
  launched = await launch({ folder });
  const { window, app } = launched;
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(900, 320); });
  await expect(window.locator('.work-row')).toHaveCount(3);
  const content = () => window.evaluate(() => { const main = document.querySelector('main')!; return { top: main.scrollTop, room: main.scrollHeight - main.clientHeight }; });
  await expect.poll(async () => (await content()).room).toBeGreaterThan(40);
  // The keyboard scrolls the content area although nothing in it has focus.
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await window.keyboard.press('End');
  await expect.poll(async () => (await content()).top).toBeGreaterThan(40);
  // End scrolls smoothly: wait until the position settles.
  let position = -1;
  await expect.poll(async () => {
    const top = (await content()).top;
    const steady = Math.abs(top - position) < 0.5;
    position = top;
    return steady;
  }, { intervals: [150] }).toBe(true);
  await views(window).getByRole('button', { name: 'Activity' }).click();
  await expect(window.locator('.activity-row')).toHaveCount(1);
  await views(window).getByRole('button', { name: /^Work/ }).click();
  await expect(window.locator('.work-row')).toHaveCount(3);
  await expect.poll(async () => Math.abs((await content()).top - position)).toBeLessThan(2);
});

test('the work list shows each version-2 ledger\'s progress and keeps version-1 status readable', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  const payments = window.locator('.work-row', { hasText: 'Saved payment methods' });
  await expect(payments.locator('.work-row-steps')).toHaveText('2/7');
  await expect(payments.locator('.work-row-steps')).toHaveAttribute('title', '2 of 7 steps done · 5 left');
  await expect(payments.locator('.work-row-focus')).toHaveText(/^Add authoriseWithToken/);
  const notifications = window.locator('.work-row', { hasText: 'Customer order notifications' });
  await expect(notifications.locator('.work-row-steps')).toHaveCount(0);
  await expect(notifications.locator('.blocked-reason')).toContainText('Mailcourier');
});

test('quick open finds work items, diagrams and files by name', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await expect(window.locator('.work-row')).toHaveCount(3);
  const palette = window.getByRole('dialog', { name: 'Quick open' });
  const input = palette.getByRole('combobox');
  const first = palette.getByRole('option').first();
  await window.keyboard.press('Control+P');
  await expect(input).toBeFocused();
  // Diagrams are listed by title once their index arrives; a work item's own name ranks it first.
  await input.fill('fulfil');
  await expect(palette.getByRole('option', { name: /Fulfilment · conceptual model/ })).toBeVisible();
  await input.fill('order fulfil');
  await expect(first).toContainText('Order fulfilment model');
  await input.press('Enter');
  await expect(window.locator('.work-header h1')).toHaveText('Order fulfilment model');

  await window.getByRole('button', { name: 'Search' }).click();
  await input.fill('reservation proposal');
  await expect(first).toContainText('Inventory · reservation proposal');
  await input.press('Enter');
  await expect(window.locator('.model-picker-title')).toHaveText('Inventory · reservation proposal');

  await window.keyboard.press('Control+P');
  await input.fill('payments-cons');
  await expect(first).toContainText('payments-constraints.md');
  await input.press('Escape');
  await expect(palette).toHaveCount(0);
});

test('activity and statistics open from the sidebar, which collapses to its icons', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await views(window).getByRole('button', { name: 'Activity' }).click();
  await expect(window.locator('.activity-row')).toHaveCount(1);
  await expect(window.locator('.activity-row')).toContainText('Fixture planning folder');
  await views(window).getByRole('button', { name: 'Statistics' }).click();
  await expect(window.locator('.stats-grid .stat')).toHaveCount(4);
  await window.getByRole('button', { name: 'Collapse sidebar' }).click();
  await window.mouse.move(800, 400);
  await expect(window.locator('.explorer')).toBeHidden();
});

test('the work page keeps the plan, ledger and diagrams sections, the About sidebar and inline diagram cards', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await window.locator('.work-row', { hasText: 'Saved payment methods' }).getByRole('link', { name: 'Saved payment methods' }).click();
  await expect(sections(window)).toHaveText([/Plan/, /Ledger/, /Diagrams\s*3/]);
  await expect(window.locator('.state-label')).toHaveText('In progress');
  // A version-2 ledger shows its steps and the work left; version 1 (work 0003) keeps current and next.
  await expect(window.locator('.about .ledger-progress-summary')).toHaveText('2 of 7 steps done · 5 left');
  await expect(window.locator('.about [role="progressbar"]')).toHaveAttribute('aria-valuenow', '2');
  await expect(window.locator('.about [role="progressbar"]')).toHaveAttribute('aria-valuetext', '2 of 7 steps done · 5 left');
  await expect(window.locator('.about .ledger-step-doing')).toContainText('Add authoriseWithToken');
  await expect(window.locator('.about .ledger-step')).toHaveCount(7);
  await sections(window).filter({ hasText: 'Plan' }).click();
  await expect(window.locator('.diagram-card').first()).toBeVisible();
  await expect(window.locator('.diagram-card-title').first()).toBeVisible();
  await window.locator('.diagram-card').first().getByRole('button', { name: 'Open diagram' }).click();
  await expect(window.locator('.diagrams .atlas-panel').first()).toBeVisible();
  await expect(activeTab(window)).toContainText('Diagrams');
});

test('the sections switcher keeps one spot in every section, floats over the scrolled page and keeps focus', async () => {
  launched = await launch({ folder });
  const { window, app } = launched;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await window.locator('.work-row a', { hasText: 'Saved payment methods' }).click();
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  // No bar with a trail: the work number is with the status, the sections one compact group.
  await expect(window.locator('.work-bar, .work-page .breadcrumb')).toHaveCount(0);
  await expect(window.locator('.work-header-meta .work-number')).toHaveText('#0001');
  const switcher = window.getByRole('radiogroup', { name: 'Work sections' });
  const place = async () => { const box = (await switcher.boundingBox())!; return { x: box.x, y: box.y }; };
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
  await sections(window).filter({ hasText: 'Plan' }).click();
  const at = await place();
  // Right below the tabs and above the title, as far in as the diagrams' islands.
  const tabs = (await window.getByRole('tablist', { name: 'Open tabs' }).boundingBox())!;
  const title = (await window.locator('.work-header h1').boundingBox())!;
  const content = (await window.locator('.workbench-page').boundingBox())!;
  expect(at.y).toBeGreaterThan(tabs.y + tabs.height);
  expect(at.y + 32).toBeLessThan(title.y);
  expect(at.x - content.x).toBeLessThan(20);
  // Scrolled, the page passes under it. The item opened on its ledger, so the plan may still be on its
  // way: the page is scrolled again until it is long enough.
  await expect.poll(async () => window.locator('main').first().evaluate(main => { main.scrollTo(0, 900); return main.scrollTop; })).toBeGreaterThan(400);
  expect(near(await place(), at)).toBe(true);
  await expect(switcher).toBeInViewport();
  await sections(window).filter({ hasText: 'Ledger' }).click();
  expect(near(await place(), at)).toBe(true);
  // In Diagrams it starts the diagram's overlay, at the same spot.
  await sections(window).filter({ hasText: 'Diagrams' }).click();
  await expect(window.locator('.diagrams .node').first()).toBeVisible();
  await expect(window.locator('.diagrams .atlas-overlay-top').getByRole('radiogroup', { name: 'Work sections' })).toBeVisible();
  expect(near(await place(), at)).toBe(true);
  // The arrow keys move between sections; focus stays on the switcher as it leaves the diagram and returns.
  await sections(window).filter({ hasText: 'Diagrams' }).focus();
  await window.keyboard.press('ArrowLeft');
  await expect(window.locator('.work-header h1')).toBeVisible();
  await expect(sections(window).filter({ hasText: 'Ledger' })).toBeFocused();
  await window.keyboard.press('ArrowRight');
  await expect(window.locator('.diagrams .node').first()).toBeVisible();
  await expect(sections(window).filter({ hasText: 'Diagrams' })).toBeFocused();
});
