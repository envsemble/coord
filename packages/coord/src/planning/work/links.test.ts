import test from 'node:test';
import assert from 'node:assert/strict';
import { appLink, appLinkOfFragment, parseAppLink, workLink, workName } from './links.ts';

test('work is named and linked by its project and its number with its part, and only such a link opens anything', () => {
  // A first part is written with the number alone and named with its 1.
  assert.deepEqual([workName('coord', 'work-0032'), workName('coord', 'work-0032-2')], ['coord#0032-1', 'coord#0032-2']);
  assert.equal(workLink('coord', 'work-0032-2'), 'https://coord.envsemble.com/open#coord/0032-2');
  assert.equal(appLink('Shop work', 'work-0032'), 'coord://open/Shop%20work/0032-1');
  assert.deepEqual([workLink('a/b', 'work-0001'), workLink('coord', 'nope')], [null, null]);
  // The page writes the app's link afresh from what the fragment names, and from nothing else.
  assert.equal(appLinkOfFragment('#coord/0032-2'), 'coord://open/coord/0032-2');
  assert.equal(appLinkOfFragment('#Shop%20work/0032'), 'coord://open/Shop%20work/0032-1');
  for (const fragment of ['', '#coord', '#coord/32', '#coord/0032-0', '#coord/0032-2/x', '#/0032', '#a:b/0032', '#coord/0032?x=1', '#%E0%A4%A/0032']) assert.equal(appLinkOfFragment(fragment), null, fragment);
  // The app opens the work a link names, as its registry writes the ID, and nothing else.
  assert.deepEqual(parseAppLink('coord://open/coord/0032-2'), { project: 'coord', work: 'work-0032-2' });
  assert.deepEqual(parseAppLink('coord://open/Shop%20work/0032-1/'), { project: 'Shop work', work: 'work-0032' });
  for (const link of ['coord://app/index.html', 'coord://open/coord', 'coord://open/coord/0032-2/../x', 'https://coord.envsemble.com/open#coord/0032', '--inspect=0', 'coord://open/coord/0032-2 --flag', 42]) assert.equal(parseAppLink(link), null, String(link));
});
