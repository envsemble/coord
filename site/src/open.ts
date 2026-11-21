// The page that forwards a link to the app (open.html, served at /open): it reads what the address
// names after the `#` (`coord/0032-2`), which never reaches a server, writes Coord's own link afresh
// from it (`coord://open/coord/0032-2`, the link the installed app is registered for) and goes
// there. Nothing but a project's name and a work item's number becomes part of that link (the rules
// are the app's own).
import { linkOfFragment } from '../../packages/coord/src/planning/work/links.ts';

const found = linkOfFragment(location.hash);
const show = (id: string) => { document.getElementById(id)!.hidden = false; };
if (found) {
  // As people name it: coord#0032-2.
  document.getElementById('what')!.textContent = found.name;
  (document.getElementById('open') as HTMLAnchorElement).href = found.link;
  document.title = found.name + ' · Open in Coord';
  show('what');
  show('go');
  // At once; the button is for a browser that asks first, or when it did nothing.
  location.href = found.link;
} else show('none');
