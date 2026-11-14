// What in a project's active work no longer adds up, for the agent at the start of a session: work
// started with no one's turn declared, work whose every step is done but that is still open, work
// that has waited on the user for days, a state nobody has touched for a day, a draft already being
// built. The agent brings them up once, briefly, and fixes what the evidence settles. Read from the
// plans and ledgers alone (no network, no database), as the session start must be quick.
import type { ActiveWork } from '../projects/findProject.ts';

const day = 24 * 60 * 60_000;
/** How long the user's turn lasts before it is worth asking about. */
const userTurnDays = 3;

const shortDate = (moment: string) => moment.slice(0, 10);

/** One line per contradiction, each naming its work item. */
export function contradictions(work: readonly ActiveWork[], now = Date.now()): string[] {
  const lines: string[] = [];
  for (const item of work) {
    if (item.problem) continue;
    const name = `${item.workId} "${item.title}"`;
    const built = item.steps.filter(step => !step.phase);
    const state = item.state;
    const since = state?.since ? Date.parse(state.since) : null;
    if (item.designStatus === 'draft' && built.some(step => step.status !== 'todo')) lines.push(`${name} is a draft whose implementation has started: accept it with the user, or record why not.`);
    if (built.length && built.every(step => step.status === 'done') && item.implementationStatus === 'in_progress') {
      lines.push(`${name} has every step done but is still open: close it once its outcome is reached (ask the user unless it was handed to you), or add the step that is left${state?.kind === 'your_turn' ? ` (it waits on the user: ${state.note})` : ''}.`);
      continue;
    }
    if (item.implementationStatus === 'in_progress' && !state && !item.blocked) lines.push(`${name} is being implemented but says nobody's turn: set its state.`);
    if (state?.kind === 'your_turn' && since !== null && now - since > userTurnDays * day) lines.push(`${name} has waited on the user since ${shortDate(state.since!)}: ${state.note}. Ask them about it.`);
    // Its plan or its ledger (a step moved) changed lately: someone is on it.
    const touched = [item.updated, item.ledgerUpdated].filter((value): value is string => Boolean(value)).sort().at(-1);
    if ((state?.kind === 'working' || state?.kind === 'planning') && since !== null && now - since > day && (!touched || now - Date.parse(touched + 'T23:59:59') > day)) {
      lines.push(`${name} has said ${state.kind} since ${shortDate(state.since!)}, and neither its plan nor its steps changed since: if nobody is on it, say whose turn it is.`);
    }
  }
  return lines;
}
