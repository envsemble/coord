// Links to work, so it can be named in any chat and opened with a click. A part is named across
// projects as `coord#0032-2`: its project (its planning folder's name in the home) and its number
// as people read it. Its link is `https://coord.envsemble.com/open#coord/0032-2`: a page of Coord's
// site, served as a file, which forwards to `coord://open/coord/0032-2`, the link the installed
// app is registered for with the system. What follows the `#` never reaches a server. Only the
// work IDs module is imported: the tools, the app and the site's page share this.
import { parseWorkId, partId } from './ids.ts';

/** The page that forwards a link to the app. */
export const linkPage = 'https://coord.envsemble.com/open';
/** The scheme the installed app is registered for, and the host of a link that opens work. */
export const linkScheme = 'coord', linkHost = 'open';

/** A planning folder's name: no separator, no control character, and not only dots. */
const projectName = /^(?!\.+$)[^:\\/\s\u0000-\u001f][^:\\/\u0000-\u001f]{0,99}$/;
const part = /^([0-9]{4,9})(?:-([1-9][0-9]{0,3}))?$/;

/** A part as a link and people name it: its work item's number and its own, `0032-2`; null for no work ID. */
export function shownPart(workId: string): string | null {
  const parsed = parseWorkId(workId);
  return parsed && parsed.number + '-' + parsed.part;
}

/** A part named across projects, as `owner/repo#12` names a PR: `coord#0032-2`. */
export function workName(project: string, workId: string): string | null {
  const shown = shownPart(workId);
  return shown && projectName.test(project) ? project + '#' + shown : null;
}

const path = (project: string, workId: string) => { const shown = shownPart(workId); return shown && projectName.test(project) ? encodeURIComponent(project) + '/' + shown : null; };

/** The link that opens a part in Coord from anywhere a link can be clicked; null when the project or the ID cannot be named. */
export function workLink(project: string, workId: string): string | null {
  const found = path(project, workId);
  return found && linkPage + '#' + found;
}

/** The link the installed app opens: `coord://open/coord/0032-2`. */
export function appLink(project: string, workId: string): string | null {
  const found = path(project, workId);
  return found && `${linkScheme}://${linkHost}/${found}`;
}

/** What `<project>/<part>` names: the project and the work ID as registries write it; null for anything else. */
function named(value: string): { project: string; work: string } | null {
  const at = value.indexOf('/');
  if (at < 1) return null;
  let project: string;
  try { project = decodeURIComponent(value.slice(0, at)); } catch { return null; }
  const match = part.exec(value.slice(at + 1));
  return match && projectName.test(project) ? { project, work: partId(match[1], match[2] === undefined ? 1 : Number(match[2])) } : null;
}

/** The work an app link names (`coord://open/<project>/<part>`, exactly); null for anything else, so nothing else is ever opened. */
export function parseAppLink(value: unknown): { project: string; work: string } | null {
  const prefix = `${linkScheme}://${linkHost}/`;
  if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > 400) return null;
  return named(value.slice(prefix.length).replace(/\/$/, ''));
}

/** What the page's fragment (`#coord/0032-2`) names: the work's name as people read it and the app link, written afresh; null when it names no work. */
export function linkOfFragment(fragment: string): { name: string; link: string } | null {
  const found = named(fragment.replace(/^#/, ''));
  const name = found && workName(found.project, found.work), link = found && appLink(found.project, found.work);
  return name && link ? { name, link } : null;
}
