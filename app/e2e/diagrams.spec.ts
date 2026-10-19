import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { close, launch, launchProject, openPlan, projectHome, removeDirectory, searchPopup, type Launched } from './app';

let launched: Launched | undefined;
let folder: string;
let dataDirectory: string;
test.beforeEach(() => { ({ dataDirectory, folder } = projectHome()); });
test.afterEach(async () => { await close(launched); launched = undefined; removeDirectory(dataDirectory); });

async function openDiagrams(window: Page, title: string) {
  // The search finds the diagrams of the open plan's project.
  if (await window.locator('.hub').count()) await openPlan(window, 'Customer order notifications');
  await window.keyboard.press('Control+P');
  const palette = searchPopup(window);
  await palette.getByRole('combobox').fill(title);
  await expect(palette.getByRole('option').first()).toContainText(title);
  await palette.getByRole('combobox').press('Enter');
  await expect(window.locator('.model-picker-title')).toHaveText(title);
  await expect(window.locator('.diagrams .node').first()).toBeVisible();
}

/** Wait until the canvas's camera has held still for a moment (it moves to a selection or a zoom). */
async function cameraSettled(window: Page) {
  const camera = () => window.locator('.diagrams #world').getAttribute('style');
  await expect.poll(async () => {
    const before = await camera();
    await window.waitForTimeout(250);
    return before === await camera();
  }).toBe(true);
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function chooseDiagram(window: Page, title: string) {
  await window.locator('.model-picker-button').click();
  await window.getByRole('menu', { name: 'Choose a diagram' }).getByRole('menuitemradio', { name: new RegExp('^' + escaped(title)) }).click();
  await expect(window.locator('.model-picker-title')).toHaveText(title);
  // Off the canvas, so no element under the pointer previews its details.
  await window.locator('.model-picker-button').hover();
}

test('the picker lists diagrams by family, one short line each, and switches between a capture and its proposals in place: nothing moves, and the details and the view stay', async () => {
  launched = await launchProject({ dataDirectory, folder });
  const { window, app } = launched;
  // As wide as the diagrams had with the plan's Files card beside them.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1720, 900));
  await openDiagrams(window, 'Checkout · captured TypeScript');
  // The picker names the diagram's origin.
  await expect(window.locator('.model-picker-button')).toContainText('Generated from code');
  await window.locator('.model-picker-button').click();
  const menu = window.getByRole('menu', { name: 'Choose a diagram' });
  // The capture heads its family, then the alternatives over it, by title, each saying how much it changes.
  const family = menu.getByRole('group', { name: 'Checkout · captured TypeScript' });
  await expect(family.getByRole('menuitemradio')).toHaveText([
    /^Checkout · captured TypeScript\s*TypeScript · captured Sep 14, 2026$/,
    /^Checkout · alternative: methods on the customer\s*10 changes to the code captured Sep 14, 2026$/,
    /^Checkout · proposed payment methods\s*15 changes to the code captured Sep 14, 2026$/,
  ]);
  await menu.getByRole('menuitemradio', { name: /Checkout · proposed payment methods/ }).click();
  await expect(window.locator('.model-picker-title')).toHaveText('Checkout · proposed payment methods');
  await window.locator('.model-picker-button').hover();

  // An element every member has, inspected.
  await window.locator('.diagrams .node[data-name="CheckoutService"]').first().click();
  const details = window.getByRole('complementary', { name: 'Model details' });
  await expect(details.getByRole('heading', { level: 1 })).toHaveText('CheckoutService');
  await expect(details.getByRole('region', { name: 'What changes' })).toContainText('placeOrderWithSavedMethod');
  // What a switch must keep: the mounted panel, the camera and where the element is drawn.
  await window.evaluate(() => { (globalThis as { shownPanel?: Element | null }).shownPanel = document.querySelector('.diagrams .atlas-panel'); });
  const placement = () => window.evaluate(() => {
    // The box itself: a changed element also draws a ring around it.
    const node = document.querySelector('.diagrams .node[data-name="CheckoutService"] .node-box')!.getBoundingClientRect();
    return {
      samePanel: (globalThis as { shownPanel?: Element | null }).shownPanel === document.querySelector('.diagrams .atlas-panel'),
      camera: document.querySelector('.diagrams #world')!.getAttribute('style'),
      node: [node.x, node.y, node.width, node.height].map(Math.round),
    };
  });
  // Let the camera settle after revealing the selection.
  await cameraSettled(window);
  const settled = await placement();
  for (const [title, changes] of [['Checkout · captured TypeScript', null], ['Checkout · alternative: methods on the customer', 'placeOrderWithSavedMethod'], ['Checkout · proposed payment methods', 'vault']] as const) {
    await chooseDiagram(window, title);
    // At once, in the same panel: no loading state, and the camera and the element where they were.
    await expect(window.locator('.diagrams-state')).toHaveCount(0);
    expect(await placement()).toEqual(settled);
    // The element's details stay open, telling what this member changes about it.
    await expect(details.getByRole('heading', { level: 1 })).toHaveText('CheckoutService');
    if (changes) await expect(details.getByRole('region', { name: 'What changes' })).toContainText(changes);
    else await expect(details.getByRole('region', { name: 'What changes' })).toHaveCount(0);
  }
  // A capture has no changes to list or fade; its proposals do.
  await chooseDiagram(window, 'Checkout · captured TypeScript');
  await expect(window.getByRole('button', { name: /^Changes, \d+$/ })).toHaveCount(0);
  await expect(window.locator('.diagrams .viewer.fade-unchanged')).toHaveCount(0);
  await chooseDiagram(window, 'Checkout · alternative: methods on the customer');
  await expect(window.getByRole('button', { name: 'Changes, 10' })).toBeVisible();
  await expect(window.locator('.diagrams .node[data-change="modified"][data-name="Customer"]').first()).toBeVisible();
  expect((await placement()).samePanel).toBe(true);
});

test('a proposal opens on its changes: the overview leads to each change, details explain it, and the keyboard steps through them without losing focus or entering a folded list', async () => {
  launched = await launchProject({ dataDirectory, folder });
  const { window, app } = launched;
  // A typical window leaves room for the overview beside the diagram.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await openDiagrams(window, 'Checkout · proposed payment methods');
  const changes = window.getByRole('button', { name: /^Changes, \d+$/ });
  await expect(changes).toHaveAttribute('aria-pressed', 'true');
  const overview = window.getByRole('complementary', { name: 'Changes in this proposal' });
  const row = (name: string) => overview.locator('button.change-row', { has: window.locator('.change-row-name', { hasText: new RegExp(`^${name}$`) }) });
  await expect(overview).toContainText('Compared with the code captured Sep 14, 2026.');
  // Changes are marked on the canvas, and what stays the same fades.
  await expect(window.locator('.diagrams .node[data-change="added"][data-name="SavedPaymentMethod"]')).toBeVisible();
  await expect(window.locator('.diagrams .viewer.fade-unchanged')).toHaveCount(1);
  await expect(row('CheckoutService')).toContainText('vault');
  await row('CheckoutService').click();
  const details = window.getByRole('complementary', { name: 'Model details' });
  await expect(details.getByRole('heading', { level: 1 })).toHaveText('CheckoutService');
  await expect(details.getByRole('region', { name: 'What changes' })).toContainText('placeOrderWithSavedMethod');
  await expect(details.getByRole('region', { name: 'Where in code' })).toContainText('src/checkout/CheckoutService.ts');
  for (const noise of ['observed', 'Capture ·', 'Mappings']) await expect(details).not.toContainText(noise);
  // Keyboard focus lands on the way back; the next change follows.
  await expect(details.getByRole('button', { name: 'All changes' })).toBeFocused();
  const position = details.locator('.change-position');
  const before = await position.textContent();
  await details.getByRole('button', { name: 'Next change' }).click();
  await expect(position).not.toHaveText(before ?? '');
  await details.getByRole('button', { name: 'All changes' }).click();
  await expect(overview).toBeVisible();
  // The Changes button hides the overview and shows it again.
  await changes.click();
  await expect(overview).toBeHidden();
  await changes.click();
  await expect(overview).toBeVisible();

  // Down from the last new type reaches the folded relations' summary, not a hidden row inside.
  await row('SavedPaymentMethod').focus();
  await window.keyboard.press('ArrowDown');
  await expect(overview.locator('.change-relations > summary').first()).toBeFocused();
  await window.keyboard.press('ArrowDown');
  await expect(row('AcquirerGateway')).toBeFocused();
  await window.keyboard.press('End');
  await expect(row('PaymentGateway')).toBeFocused();
  // At the last change, Next stays focused and says it has nowhere to go.
  await window.keyboard.press('Enter');
  await expect(details.locator('.change-position')).toContainText('15 of 15');
  const next = details.getByRole('button', { name: 'Next change' });
  await next.focus();
  await window.keyboard.press('Enter');
  await expect(next).toBeFocused();
  await expect(next).toHaveAttribute('aria-disabled', 'true');
  await expect(details.locator('.change-position')).toContainText('15 of 15');
  // The position names the change it announces.
  await expect(details.locator('.change-position')).toContainText('PaymentGateway');
});

test('the details resize from their inner edge, by pointer or keyboard, and keep their width', async () => {
  try {
    launched = await launchProject({ dataDirectory, folder });
    let { window, app } = launched;
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
    await openDiagrams(window, 'Checkout · proposed payment methods');
    const card = window.locator('.diagrams .inspector.open');
    await expect(card).toBeVisible();
    const handle = card.getByRole('separator', { name: 'Resize details' });
    await expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    const width = async () => Math.round((await card.boundingBox())!.width);
    const start = await width();
    expect(Number(await handle.getAttribute('aria-valuenow'))).toBe(start);
    // Dragging the edge to the left widens the card, selecting no text.
    const box = (await handle.boundingBox())!;
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await window.mouse.down();
    await window.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 5 });
    await expect(window.locator('.diagrams .viewer.resizing')).toHaveCount(1);
    await window.mouse.up();
    await expect(window.locator('.diagrams .viewer.resizing')).toHaveCount(0);
    expect(await window.evaluate(() => getSelection()?.toString() ?? '')).toBe('');
    await expect.poll(width).toBe(start + 100);
    // The arrow keys move the edge, and Home and End reach the narrowest and widest card.
    await handle.focus();
    await window.keyboard.press('ArrowRight');
    await expect(handle).toHaveAttribute('aria-valuenow', String(start + 84));
    await window.keyboard.press('Home');
    await expect(handle).toHaveAttribute('aria-valuenow', await handle.getAttribute('aria-valuemin') ?? '');
    await window.keyboard.press('End');
    const widest = Number(await handle.getAttribute('aria-valuemax'));
    await expect(handle).toHaveAttribute('aria-valuenow', String(widest));
    expect(await width()).toBe(widest);
    // A narrower window narrows a wide card with it.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 800));
    await expect.poll(async () => Number(await handle.getAttribute('aria-valuenow'))).toBeLessThan(widest);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
    await expect(handle).toHaveAttribute('aria-valuenow', String(widest));
    await window.keyboard.press('Shift+ArrowRight');
    const chosen = widest - 48;
    await expect(handle).toHaveAttribute('aria-valuenow', String(chosen));
    // Keys held with Alt are the window's: Alt+← goes back instead of moving the edge.
    await window.keyboard.press('Alt+ArrowLeft');
    await expect(window.locator('.diagrams')).toHaveCount(0);
    await window.keyboard.press('Alt+ArrowRight');
    await expect(window.locator('.diagrams .node').first()).toBeVisible();
    await expect(window.locator('.diagrams .inspector.open').getByRole('separator', { name: 'Resize details' })).toHaveAttribute('aria-valuenow', String(chosen));
    // The width is kept with the windows' layout.
    await window.waitForTimeout(600);
    await close(launched);
    launched = await launch({ dataDirectory });
    ({ window, app } = launched);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
    await expect(window.locator('.diagrams .node').first()).toBeVisible();
    await expect(window.locator('.diagrams .inspector.open').getByRole('separator', { name: 'Resize details' })).toHaveAttribute('aria-valuenow', String(chosen));
  } finally {
    await close(launched);
    launched = undefined;
  }
});

test('a class diagram opens from its card with its scenarios as its guide and a full view; an element chip and a link in the plan open it at that element, and Back returns to the plan', async () => {
  launched = await launchProject({ dataDirectory, folder });
  const { window } = launched;
  await openPlan(window, 'Order fulfilment model');
  // The links under a heading attach the diagram's card there, with the elements they name.
  const card = window.locator('.diagram-card', { hasText: 'Fulfilment · conceptual model' }).first();
  await expect(card.locator('.element-chip')).toHaveText(['Order', 'Shipment']);
  await card.getByRole('button', { name: 'Open diagram' }).click();
  await expect(window.locator('.model-picker-title')).toHaveText('Fulfilment · conceptual model');
  await expect(window.locator('.diagrams .node').first()).toBeVisible();
  // The scenario that exemplifies the class diagram is listed beside it.
  await window.locator('.model-picker-button').click();
  await expect(window.getByRole('menu', { name: 'Choose a diagram' }).getByRole('group', { name: 'Diagrams' }).getByRole('menuitemradio')).toHaveText([
    /^Fulfilment · conceptual model\s*Class diagram$/,
    /^Order 1042 split across Berlin and Leeds\s*Scenario of Fulfilment · conceptual model$/,
  ]);
  await window.keyboard.press('Escape');
  // Its examples guide the model.
  const understand = window.getByRole('button', { name: 'Understand the model' });
  await understand.click();
  const guide = window.getByRole('complementary', { name: 'Model guide' });
  await expect(guide).toContainText('Order 1042 split across Berlin and Leeds');
  await understand.click();
  await expect(guide).toBeHidden();
  // Full view hides the work header; Escape returns.
  await window.getByRole('button', { name: /full ?screen|full view/i }).first().click();
  await expect(window.locator('.diagrams.fullscreen')).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(window.locator('.diagrams.fullscreen')).toHaveCount(0);
  await window.keyboard.press('Alt+ArrowLeft');
  await expect(window.locator('.work-header h1')).toHaveText('Order fulfilment model');

  // A chip opens the diagram at its element.
  await card.locator('.element-chip', { hasText: 'Shipment' }).click();
  // Off the canvas, so no element under the pointer previews its details.
  await window.locator('.model-picker-button').hover();
  const details = window.locator('.inspector.open');
  await expect(details.getByRole('heading', { level: 1 })).toHaveText('Shipment');
  await window.keyboard.press('Alt+ArrowLeft');
  await expect(window.locator('.work-header h1')).toHaveText('Order fulfilment model');
  // A link in the text opens the diagram too, at the element its fragment names.
  await window.locator('.prose a', { hasText: 'orders' }).first().click();
  await expect(window.locator('.model-picker-title')).toHaveText('Fulfilment · conceptual model');
  await window.locator('.model-picker-button').hover();
  await expect(details.getByRole('heading', { level: 1 })).toHaveText('Order');
});

test('a card sits under its heading however the heading is written, a fragment may name a class as it reads, and a diagram with problems shows them instead of drawing', async () => {
  const work = path.join(folder, 'active/0002-order-fulfilment-model');
  writeFileSync(path.join(work, 'diagrams/broken.puml'), '@startuml\ntitle Broken\nclass A\nclass B\nA -up-> B\n@enduml\n');
  writeFileSync(path.join(work, 'diagrams/lines.puml'), '@startuml\ntitle Order lines\nclass "Order Item" as OrderItem\nclass Order\nOrder "1" *-- "1..*" OrderItem : lines\n@enduml\n');
  const plan = path.join(work, 'plan.md');
  writeFileSync(plan, readFileSync(plan, 'utf8') + '\n## The `order_items` table\n\nEach row is an [order item](diagrams/lines.puml#Order%20Item).\n\n## Open questions\n\nThe [lines](diagrams/lines.puml) again.\n');
  launched = await launchProject({ dataDirectory, folder });
  const { window } = launched;
  await openPlan(window, 'Order fulfilment model');
  const after = (heading: Locator) => heading.locator('xpath=following-sibling::*[1]');
  // Code and underscores in a heading, and the second of two equal headings, each get their card.
  const table = after(window.locator('.prose h2', { hasText: 'order_items' }));
  await expect(table).toHaveClass(/diagram-cards/);
  await expect(table.locator('.element-chip')).toHaveText(['Order Item']);
  const questions = window.locator('.prose h2', { hasText: 'Open questions' });
  await expect(questions).toHaveCount(2);
  await expect(after(questions.first())).not.toHaveClass(/diagram-cards/);
  await expect(after(questions.last())).toContainText('Order lines');
  // The chip names the class by its display name; the diagram opens at it.
  await table.locator('.element-chip').click();
  await expect(window.locator('.model-picker-title')).toHaveText('Order lines');
  await window.locator('.model-picker-button').hover();
  await expect(window.locator('.inspector.open').getByRole('heading', { level: 1 })).toHaveText('Order Item');
  // A diagram with problems is listed apart, and shows them instead of drawing.
  await window.locator('.model-picker-button').click();
  const problems = window.getByRole('menu', { name: 'Choose a diagram' }).getByRole('group', { name: 'With problems' });
  await expect(problems.getByRole('menuitemradio')).toHaveText([/^Broken\s*1 problem$/]);
  await problems.getByRole('menuitemradio').click();
  await expect(window.locator('.diagrams-state')).toContainText('This diagram has problems');
  await expect(window.locator('.diagram-problems')).toContainText('Line 5, column');
  await expect(window.locator('.diagram-problems')).toContainText('up');
});

/**
 * Where a node's name is painted, measured in a screenshot (layout boxes cannot show this: the bug
 * they miss is glyphs painted wider than their laid-out text). Returns the blank space left and
 * right of the light text pixels in the band holding the name.
 */
async function paintedNameMargins(window: Page, node: Locator) {
  const png = (await node.screenshot()).toString('base64');
  return window.evaluate(async source => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + source;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
    let left = width, right = -1;
    // The name line sits in the lower half of a header-only node; the change marker is at the top left.
    // The box's change border and the ring around it lie within the outer 12 pixels.
    for (let y = Math.round(height * 0.5); y < Math.round(height * 0.9); y++) {
      for (let x = 12; x < width - 12; x++) {
        const offset = (y * width + x) * 4;
        if (0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2] > 170) { left = Math.min(left, x); right = Math.max(right, x); }
      }
    }
    return { left, right: width - 1 - right, width };
  }, png);
}

test('node names stay centred in their boxes below 100% zoom', async () => {
  launched = await launchProject({ dataDirectory, folder });
  const { window, app } = launched;
  // A fixed window size, so the measured node is clear of the floating toolbars.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  // The measurement looks for light text on a dark box.
  await window.emulateMedia({ colorScheme: 'dark' });
  await openDiagrams(window, 'Checkout · proposed payment methods');
  // Attributes show by default; the measurement reads a header-only box, so they are hidden here.
  const fields = window.locator('.diagrams').getByRole('button', { name: 'Fields', exact: true });
  await expect(fields).toHaveAttribute('aria-pressed', 'true');
  await fields.click();
  await expect(fields).toHaveAttribute('aria-pressed', 'false');
  const zoom =window.getByRole('button', { name: /^Zoom \d+%/ });
  for (const step of ['fit', 'out'] as const) {
    // The canvas's own zoom-out key (the toolbar may fold its zoom buttons away in a narrow window).
    if (step === 'out') await window.keyboard.press('-');
    const percent = Number(/Zoom (\d+)%/.exec((await zoom.getAttribute('aria-label')) ?? '')?.[1]);
    expect(percent).toBeLessThan(100);
    // Let the camera settle before measuring paint.
    await cameraSettled(window);
    await window.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const node = window.locator('.diagrams .node[data-name="PaymentMethodVault"]').first();
    const margins = await paintedNameMargins(window, node);
    expect(margins.right, `painted name reaches the box edge at ${percent}%`).toBeGreaterThan(4);
    expect(Math.abs(margins.left - margins.right), `name off centre at ${percent}%: ${JSON.stringify(margins)}`).toBeLessThanOrEqual(6);
  }
});
