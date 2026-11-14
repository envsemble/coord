import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
  await expect(window.locator('.diagrams .diagram-title')).toHaveText(title);
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

const node = (window: Page, name: string) => window.locator(`.diagrams .diagram-base .node[data-name="${name}"]`);

test('a capture, its later captures and its proposals are one diagram with layers: the Files tree lists them under the capture and switches them in place, as [ and ] do, and Back returns to the layer before', async () => {
  launched = await launchProject({ dataDirectory, folder });
  const { window, app } = launched;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1720, 900));
  // A proposal opens with its changes beside it, which stay open across its family's proposals.
  await openDiagrams(window, 'Checkout · proposed payment methods');
  // The Files tree lists the layers under the capture, the proposals by title, the one shown marked; no picker, no card over the canvas.
  const tree = window.locator('.plan-files');
  const layer = (file: string) => tree.locator(`[role="treeitem"][data-id="f:active/0001-saved-payment-methods/diagrams/${file}"]`);
  await expect(tree.locator('[role="treeitem"][data-id*="/diagrams/checkout-"]')).toHaveText(['checkout-capture.puml Captured', 'checkout-alternative.puml Proposal', 'checkout-proposal.puml Proposal']);
  await expect(layer('checkout-capture.puml')).toHaveAttribute('aria-expanded', 'true');
  await expect(layer('checkout-proposal.puml')).toHaveAttribute('aria-selected', 'true');
  await expect(window.getByRole('menu', { name: 'Choose a diagram' })).toHaveCount(0);
  await expect(window.locator('.diagrams .layer-list')).toHaveCount(0);

  // An element every layer has, selected.
  await node(window, 'CheckoutService').click();
  await expect(node(window, 'CheckoutService')).toHaveAttribute('aria-pressed', 'true');
  // What a switch must keep: the mounted panel, the camera, the selection and where the element is drawn.
  await window.evaluate(() => { (globalThis as { shownPanel?: Element | null }).shownPanel = document.querySelector('.diagrams .coord-panel'); });
  const placement = () => window.evaluate(() => {
    // The box itself: a changed element also draws a ring around it.
    const box = document.querySelector('.diagrams .diagram-base .node[data-name="CheckoutService"] .node-box')!.getBoundingClientRect();
    return {
      samePanel: (globalThis as { shownPanel?: Element | null }).shownPanel === document.querySelector('.diagrams .coord-panel'),
      camera: document.querySelector('.diagrams #world')!.getAttribute('style'),
      node: [box.x, box.y, box.width, box.height].map(Math.round),
    };
  });
  await cameraSettled(window);
  const settled = await placement();
  // ] steps to the next layer, the marker following; [ steps back, and from the first to the last.
  const title = window.locator('.diagrams .diagram-title');
  for (const [key, shown] of [[']', 'Checkout · captured TypeScript'], [']', 'Checkout · alternative: methods on the customer'], [']', 'Checkout · proposed payment methods'], ['[', 'Checkout · alternative: methods on the customer']] as const) {
    await window.keyboard.press(key);
    await expect(title).toHaveText(shown);
    // At once, in the same panel: no loading state, and the camera and the element where they were.
    await expect(window.locator('.diagrams-state')).toHaveCount(0);
    expect(await placement()).toEqual(settled);
    await expect(node(window, 'CheckoutService')).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(layer('checkout-alternative.puml')).toHaveAttribute('aria-selected', 'true');
  // A proposal lists and fades its changes; the capture has none.
  await expect(window.getByRole('button', { name: /^Changes, \d+$/ })).toBeVisible();
  await layer('checkout-capture.puml').click();
  await expect(title).toHaveText('Checkout · captured TypeScript');
  await expect(window.getByRole('button', { name: /^Changes, \d+$/ })).toHaveCount(0);
  await expect(window.locator('.diagrams .viewer.fade-unchanged')).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'Show changes' })).toHaveCount(0);
  // Each switch is a step: Back returns to the layer before.
  await window.keyboard.press('Alt+ArrowLeft');
  await expect(title).toHaveText('Checkout · alternative: methods on the customer');
  expect((await placement()).samePanel).toBe(true);
});

test('a proposal opens on its changes: a change chosen or stepped to is selected on the canvas, and the keyboard steps through them without losing focus or entering a folded list', async () => {
  launched = await launchProject({ dataDirectory, folder });
  const { window, app } = launched;
  // A typical window leaves room for the changes beside the diagram.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await openDiagrams(window, 'Checkout · proposed payment methods');
  const changes = window.getByRole('button', { name: /^Changes, \d+$/ });
  await expect(changes).toHaveAttribute('aria-pressed', 'true');
  const overview = window.getByRole('complementary', { name: 'Changes in this proposal' });
  const row = (name: string) => overview.locator('button.change-row', { has: window.locator('.change-row-name', { hasText: new RegExp(`^${name}$`) }) });
  await expect(overview).toContainText('Compared with the code captured Sep 14, 2026.');
  // Changes are marked on the canvas, and what stays the same fades.
  await expect(window.locator('.diagrams .node[data-change="added"][data-name="SavedPaymentMethod"]').first()).toBeVisible();
  await expect(window.locator('.diagrams .viewer.fade-unchanged')).toHaveCount(1);
  await expect(row('CheckoutService')).toContainText('vault');
  // A change chosen is selected on the canvas, and the stepper says which it is.
  await row('CheckoutService').click();
  await expect(node(window, 'CheckoutService')).toHaveAttribute('aria-pressed', 'true');
  const position = overview.locator('.change-position');
  await expect(position).toContainText(/^\d+ of 15/);
  const before = await position.textContent();
  await overview.getByRole('button', { name: 'Next change' }).click();
  await expect(position).not.toHaveText(before ?? '');
  await expect(node(window, 'CheckoutService')).toHaveAttribute('aria-pressed', 'false');
  // No element details open.
  await expect(window.getByRole('complementary', { name: 'Model details' })).toHaveCount(0);
  // The Changes button hides the changes and shows them again.
  await changes.click();
  await expect(overview).toBeHidden();
  await changes.click();
  await expect(overview).toBeVisible();
  // With its changes off, the proposal shows plainly where it stood: no marks, no removed elements, no Changes.
  const added = node(window, 'SavedPaymentMethod').first();
  const place = await added.getAttribute('transform');
  const shown = window.getByRole('button', { name: 'Show changes' });
  await shown.click();
  await expect(shown).toHaveAttribute('aria-pressed', 'false');
  await expect(window.locator('.diagrams [data-change]:not([data-change="unchanged"])')).toHaveCount(0);
  await expect(changes).toHaveCount(0);
  await expect(overview).toHaveCount(0);
  await expect(window.locator('.diagrams .viewer.fade-unchanged')).toHaveCount(0);
  await expect(added).toHaveAttribute('transform', place ?? '');
  await shown.click();
  await expect(changes).toHaveAttribute('aria-pressed', 'true');
  await expect(window.locator('.diagrams .node[data-change="added"][data-name="SavedPaymentMethod"]').first()).toBeVisible();

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
  await expect(position).toContainText('15 of 15');
  const next = overview.getByRole('button', { name: 'Next change' });
  await next.focus();
  await window.keyboard.press('Enter');
  await expect(next).toBeFocused();
  await expect(next).toHaveAttribute('aria-disabled', 'true');
  await expect(position).toContainText('15 of 15');
  // The position names the change it announces.
  await expect(position).toContainText('PaymentGateway');
});

test('an element dragged stays where it was put, in the arrangement beside the diagram and after reopening, and Reset layout lays the diagram out again', async () => {
  try {
    const sidecar = path.join(folder, 'active/0002-order-fulfilment-model/diagrams/fulfilment.layout.json');
    launched = await launchProject({ dataDirectory, folder });
    let { window, app } = launched;
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
    await openPlan(window, 'Order fulfilment model');
    await window.locator('.prose .diagram-link', { hasText: 'class diagram' }).click();
    await expect(window.locator('.diagrams .diagram-title')).toHaveText('Fulfilment · conceptual model');
    await cameraSettled(window);
    // Where one element is drawn against another, which the camera does not change.
    const apart = async () => {
      const [a, b] = await Promise.all([node(window, 'Carrier').locator('.node-box').boundingBox(), node(window, 'Warehouse').locator('.node-box').boundingBox()]);
      const scale = a!.width / Number(await node(window, 'Carrier').locator('.node-box').getAttribute('width'));
      return [Math.round((a!.x - b!.x) / scale), Math.round((a!.y - b!.y) / scale)];
    };
    const automatic = await apart();
    await expect(window.getByRole('button', { name: 'Reset layout' })).toHaveCount(0);
    // Dragged by its box, the element follows; the canvas does not pan.
    const box = (await node(window, 'Carrier').locator('.node-box').boundingBox())!;
    const camera = await window.locator('.diagrams #world').getAttribute('style');
    await window.mouse.move(box.x + box.width / 2, box.y + 12);
    await window.mouse.down();
    await window.mouse.move(box.x + box.width / 2 + 160, box.y + 12 + 90, { steps: 8 });
    await window.mouse.up();
    expect(await window.locator('.diagrams #world').getAttribute('style')).toBe(camera);
    const moved = await apart();
    expect(moved).not.toEqual(automatic);
    // The drag is no click: nothing is selected.
    await expect(node(window, 'Carrier')).toHaveAttribute('aria-pressed', 'false');
    // The arrangement is saved beside the diagram, every element's place in it, and the Files tree does not list it.
    await expect.poll(() => existsSync(sidecar)).toBe(true);
    const saved = JSON.parse(readFileSync(sidecar, 'utf8')) as { positions: Record<string, [number, number]> };
    expect(Object.keys(saved.positions)).toEqual(expect.arrayContaining(['Carrier', 'Warehouse', 'Order']));
    await expect(window.locator('[role="treeitem"]', { hasText: 'fulfilment.layout.json' })).toHaveCount(0);
    // Reopened, it is where it was put.
    await close(launched);
    launched = await launch({ dataDirectory });
    ({ window, app } = launched);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
    await expect(window.locator('.diagrams .diagram-title')).toHaveText('Fulfilment · conceptual model');
    await cameraSettled(window);
    expect(await apart()).toEqual(moved);
    // Reset layout returns to the automatic layout, and the arrangement goes.
    await window.getByRole('button', { name: 'Reset layout' }).click();
    await expect.poll(apart).toEqual(automatic);
    await expect.poll(() => existsSync(sidecar)).toBe(false);
    await expect(window.getByRole('button', { name: 'Reset layout' })).toHaveCount(0);
  } finally {
    await close(launched);
    launched = undefined;
  }
});

test('a class diagram opens from its link with its scenarios as its guide; a link naming an element opens it at that element, selected, and Back returns to the plan', async () => {
  launched = await launchProject({ dataDirectory, folder });
  const { window } = launched;
  await openPlan(window, 'Order fulfilment model');
  // A link to a diagram shows as the diagram's, its tooltip naming it and where it came from.
  const link = window.locator('.prose .diagram-link', { hasText: 'class diagram' });
  await expect(link).toHaveAttribute('title', 'Fulfilment · conceptual model · Agent-authored');
  await link.click();
  // The diagram is named by its heading and its row in the Files tree, marked there; nothing floats over the canvas to name it.
  await expect(window.locator('.diagrams .diagram-title')).toHaveText('Fulfilment · conceptual model');
  await expect(window.locator('.plan-files [role="treeitem"][data-id$="/diagrams/fulfilment.puml"]')).toHaveAttribute('aria-selected', 'true');
  await expect(window.locator('.diagrams .island-start')).toHaveCount(0);
  await expect(window.locator('.diagrams .node').first()).toBeVisible();
  // No full view, search, attributes toggle or details toggle; attributes show.
  for (const name of [/full ?screen|full view/i, /^Fields$/, /^Search/, /details$/]) await expect(window.locator('.diagrams').getByRole('button', { name })).toHaveCount(0);
  await expect(node(window, 'Warehouse').locator('.attributes text').first()).toBeVisible();
  // No stereotype is drawn.
  await expect(window.locator('.diagrams .diagram-base')).not.toContainText('«');
  // Its examples guide the model.
  const understand = window.getByRole('button', { name: 'Understand the model' });
  await understand.click();
  const guide = window.getByRole('complementary', { name: 'Model guide' });
  await expect(guide).toContainText('Order 1042 split across Berlin and Leeds');
  await understand.click();
  await expect(guide).toHaveCount(0);
  await window.keyboard.press('Alt+ArrowLeft');
  await expect(window.locator('.work-page h1')).toHaveText('Order fulfilment model');

  // A link naming an element opens the diagram at it, selected.
  await window.locator('.prose .diagram-link', { hasText: 'shipments' }).click();
  await expect(node(window, 'Shipment')).toHaveAttribute('aria-pressed', 'true');
  await window.keyboard.press('Alt+ArrowLeft');
  await expect(window.locator('.work-page h1')).toHaveText('Order fulfilment model');
  // Another one, at its element too.
  await window.locator('.prose .diagram-link', { hasText: 'orders' }).first().click();
  await expect(window.locator('.diagrams .diagram-title')).toHaveText('Fulfilment · conceptual model');
  await expect(node(window, 'Order')).toHaveAttribute('aria-pressed', 'true');
});

test('a link may name a class as it reads, and a diagram with problems shows them instead of drawing', async () => {
  const work = path.join(folder, 'active/0002-order-fulfilment-model');
  writeFileSync(path.join(work, 'diagrams/broken.puml'), '@startuml\ntitle Broken\nclass A\nclass B\nA -up-> B\n@enduml\n');
  writeFileSync(path.join(work, 'diagrams/lines.puml'), '@startuml\ntitle Order lines\nclass "Order Item" as OrderItem\nclass Order\nOrder "1" *-- "1..*" OrderItem : lines\n@enduml\n');
  const plan = path.join(work, 'plan.md');
  writeFileSync(plan, readFileSync(plan, 'utf8') + '\n## The `order_items` table\n\nEach row is an [order item](diagrams/lines.puml#Order%20Item).\n\n## Open questions\n\nThe [lines](diagrams/lines.puml) again, and the [broken one](diagrams/broken.puml).\n');
  launched = await launchProject({ dataDirectory, folder });
  const { window } = launched;
  await openPlan(window, 'Order fulfilment model');
  // The link names the class by its display name; the diagram opens at it.
  await window.locator('.prose .diagram-link', { hasText: 'order item' }).click();
  await expect(window.locator('.diagrams .diagram-title')).toHaveText('Order lines');
  await expect(node(window, 'Order Item')).toHaveAttribute('aria-pressed', 'true');
  // A diagram with problems shows them instead of drawing.
  await window.keyboard.press('Alt+ArrowLeft');
  await window.locator('.prose .diagram-link', { hasText: 'broken one' }).click();
  await expect(window.locator('.diagrams-state')).toContainText('This diagram has problems');
  await expect(window.locator('.diagram-problems')).toContainText('Line 5, column');
  await expect(window.locator('.diagram-problems')).toContainText('up');
});

/**
 * Where a node's name is painted, measured in a screenshot (layout boxes cannot show this: the bug
 * they miss is glyphs painted wider than their laid-out text). Returns the blank space left and
 * right of the light text pixels in the band of the header holding the name.
 */
async function paintedNameMargins(window: Page, target: Locator) {
  const png = (await target.screenshot()).toString('base64');
  const boxHeight = Number(await target.locator('.node-box').getAttribute('height'));
  return window.evaluate(async ({ source, boxHeight }) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + source;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const { data, width } = context.getImageData(0, 0, image.width, image.height);
    // The name sits in the 56-unit header, below a change marker at the top left: rows 26 to 42 of it.
    const scale = image.height / boxHeight;
    let left = width, right = -1;
    // The box's change border and the ring around it lie within the outer 12 pixels.
    for (let y = Math.round(26 * scale); y < Math.round(42 * scale); y++) {
      for (let x = 12; x < width - 12; x++) {
        const offset = (y * width + x) * 4;
        if (0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2] > 170) { left = Math.min(left, x); right = Math.max(right, x); }
      }
    }
    return { left, right: width - 1 - right, width };
  }, { source: png, boxHeight });
}

test('node names stay centred in their boxes below 100% zoom', async () => {
  launched = await launchProject({ dataDirectory, folder });
  const { window, app } = launched;
  // A fixed window size, so the measured node is clear of the floating toolbars.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  // The measurement looks for light text on a dark box.
  await window.emulateMedia({ colorScheme: 'dark' });
  // A diagram without layers, so nothing floats over the measured node.
  await openDiagrams(window, 'Fulfilment · conceptual model');
  const zoom = window.getByRole('button', { name: /^Zoom \d+%/ });
  for (const step of ['fit', 'out'] as const) {
    // The canvas's own zoom-out key (the toolbar may fold its zoom buttons away in a narrow window).
    if (step === 'out') await window.keyboard.press('-');
    const percent = Number(/Zoom (\d+)%/.exec((await zoom.getAttribute('aria-label')) ?? '')?.[1]);
    expect(percent).toBeLessThan(100);
    // Let the camera settle before measuring paint.
    await cameraSettled(window);
    await window.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const margins = await paintedNameMargins(window, node(window, 'Carrier').first());
    expect(margins.right, `painted name reaches the box edge at ${percent}%`).toBeGreaterThan(4);
    expect(Math.abs(margins.left - margins.right), `name off centre at ${percent}%: ${JSON.stringify(margins)}`).toBeLessThanOrEqual(6);
  }
});
