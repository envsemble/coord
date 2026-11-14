// `atlas mcp`: the planning-state operations for an agent harness, over stdio. The same operations
// as the work commands, called in-process. Prose (plans, glossaries, the final-review list) and diagrams are
// files agents edit directly, so there are no tools for them.
// Every definition and result lands in the agent's context, so both stay lean: the rules are stated
// once in the instructions, and a result carries what the agent needs after the call (see `shaped`).
import { createRequire } from 'node:module';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  acceptWork, addSteps, archiveWork, proposeSteps, projectTags, searchWork, tagWork, closeWork, createWork, findPlanning, DatabaseVersionError, PlanningNotFoundError, removeStep, renameStep, reopenWork, setContinues, setParts,
  resolvePlanningFolder, setBlocked, setStepStatus, startWork, WorkError, workStatus, type LedgerStepStatus,
} from '../../planning/index.ts';
import type { Whereabouts } from '../../planning/projects/findProject.ts';
import type { WorkResult } from '../../planning/work/work.ts';
import { agentOfClient, noteActivity } from '../../agents/activity.ts';
import { atlasHome } from '../../home/homePath.ts';
import { parseOptions, UsageError, wantsHelp, type Output } from '../args.ts';
import { createHomeProject } from './planning.ts';

const require = createRequire(import.meta.url);
const { version } = require('../../../package.json') as { version: string };

const instructions = "Atlas keeps plans in projects: planning folders in the Atlas home (~/.atlas/planning). A session in one of a project's folders (the deepest wins when they nest), or in its planning folder, belongs to that project; where lists the projects and their active work. "
  + 'When several projects match, ask the user which one to plan in and pass its planningFolder; when none does, ask which project the work belongs to. '
  + 'Ask the user before project_create or work_create (a follow-up of work they handed you to finish without them you create yourself), and open work items only for work big enough to plan; small tasks stay plain coding. '
  + 'Change planning state (work items, steps, blocked, closing, archiving) only through these tools; edit plan prose, glossaries and diagrams directly as files in the planning folder. '
  + 'When work continues other work (follow-ups moved off work that is closing, a next phase), record the handoff with continues. '
  + 'When one task is better planned as several ordered pieces, each with its own plan and steps, make them its parts (work_create with partOf; work_parts). '
  + "Tag work with what it will be searched for later: the release it ships in and the areas it touches, reusing the project's tags (where and work_tag count them). "
  + 'Answer questions about past work with work_search. '
  + 'In planning files, write PRs and issues as owner/repo#N and commits as owner/repo@hash (or their URLs), naming the repository yourself, so Atlas links them. '
  + 'When you stop for the user to act (a question, a decision, finished work to review), call needs_you and begin your message with what you need; a turn that ends without it, as one waiting on CI or a background task, shows as still working. The tools never commit; commit planning changes yourself.';

const planningFolder = { type: 'string', description: "The project's planning folder, an absolute path; needed only when several projects or none cover your folder." };
const cwd = { type: 'string', description: "Your folder, when it isn't the session's." };
const work = { type: 'string', pattern: '^work-[0-9]{4,}$' };
const titles = (description?: string) => ({ type: 'array', items: { type: 'string' }, ...description && { description } });
const continues = titles("Work items it continues: work-0023, or project:work-0023 in another project (its planning folder's name).");
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: { ...properties, planningFolder, cwd }, required, additionalProperties: false });

/** What each action of the step tool takes, and how to say so when a call gets it wrong. */
const stepFields = {
  add: { fields: ['steps'], needs: 'steps, a non-empty list of titles' },
  propose: { fields: ['steps'], needs: 'steps, a list of titles (empty removes the proposed steps)' },
  set: { fields: ['step', 'status'], needs: 'step (its title) and status (todo, doing or done)' },
  rename: { fields: ['step', 'to'], needs: 'step (its title) and to (the new title)' },
  remove: { fields: ['step'], needs: 'step (its title)' },
} as const;
type StepAction = keyof typeof stepFields;
const filled = (value: unknown) => typeof value === 'string' && value.trim() !== '';
const stepValid: Record<string, (value: unknown) => boolean> = {
  steps: value => Array.isArray(value) && value.length > 0 && value.every(filled), step: filled, to: filled, status: value => ['todo', 'doing', 'done'].includes(value as string),
};

/** The step tool's action, refused unless the call gives exactly that action's fields, each well formed. */
function stepAction(input: Arguments): StepAction {
  const action = input.action as StepAction;
  if (typeof action !== 'string' || !Object.hasOwn(stepFields, action)) throw new WorkError('Give the step tool an action: add, propose, set, rename or remove.');
  const { fields, needs } = stepFields[action];
  const others = Object.keys(stepValid).filter(field => input[field] !== undefined && !(fields as readonly string[]).includes(field));
  const valid = (field: string) => action === 'propose' && field === 'steps' ? Array.isArray(input.steps) && input.steps.every(filled) : stepValid[field](input[field]);
  if (others.length || fields.some(field => !valid(field))) throw new WorkError(`The step action ${action} needs ${needs}` + (others.length ? `, and not ${others.join(' or ')}.` : '.'));
  return action;
}

interface Arguments { planningFolder?: string; cwd?: string; work?: string; [key: string]: unknown }
interface Tool { name: string; description: string; inputSchema: Record<string, unknown>; run(root: string, input: Arguments): Promise<unknown> }

const tools: Tool[] = [
  {
    name: 'where',
    description: 'The projects your folder belongs to (matches: planning folder and active work with steps and blocked), and every active project in the home (projects: planning folder, folders, and the active work of the others in brief). Call it when you need your work\'s plan or ledger and have no Atlas session context.',
    inputSchema: { type: 'object', properties: { cwd }, additionalProperties: false },
    run: async (_, input) => leanWhere(await findPlanning(input.cwd!)),
  },
  {
    name: 'needs_you', description: 'Call when you stop for the user to act; Atlas shows Needs you, with the reason, until they answer.',
    inputSchema: { type: 'object', properties: { reason: { type: 'string', description: 'What you need, in a few words: "review PR #24".' } }, additionalProperties: false },
    run: async () => ({ noted: true }),
  },
  {
    name: 'project_create',
    description: 'Ask the user first. Create a project in the Atlas home: a planning folder, its own Git repository, covering the folders given. Check with where that none covers them yet.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['name', 'folders'], properties: {
        name: { type: 'string' },
        folders: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of the folders it covers; may be empty.' },
      },
    },
    run: (_, input) => {
      if (!Array.isArray(input.folders)) throw new WorkError('Give the folders the project covers as a list (it may be empty).');
      return createHomeProject({ name: input.name as string, folders: input.folders as string[] });
    },
  },
  {
    name: 'work_status', description: 'A work item\'s plan statuses and dates, steps, blocked and statistics.',
    inputSchema: object({ work }, ['work']), run: (root, input) => workStatus(root, input.work!),
  },
  {
    name: 'work_create',
    description: 'Ask the user first; only for work big enough to plan. Create a work item: active/NNNN-slug/ with a draft plan.md (its header holds the summary) and a ledger with the planning steps (Understand the request, doing; Settle the design; Write the plan; Accepted). Then write the plan body directly, and keep the summary and planning steps true as the design settles.',
    inputSchema: object({ title: { type: 'string' }, summary: { type: 'string', description: 'Two or three plain sentences, on one line: what the work is, why, and where it stands.' }, slug: { type: 'string', description: 'Folder name after the number; derived from the title by default.' }, continues, tags: titles('Its first tags, such as ["search"].'), partOf: { ...work, description: "The work item of this project it is a part of; it becomes the last of that group's parts." } }, ['title']),
    run: (root, input) => createWork(root, { title: input.title as string, slug: (input.slug as string | undefined) ?? null, summary: (input.summary as string | undefined) ?? null, continues: (input.continues as string[] | undefined) ?? null, tags: (input.tags as string[] | undefined) ?? null, partOf: (input.partOf as string | undefined) ?? null }),
  },
  {
    name: 'work_tag', description: "Add and remove a work item's tags (lowercase letters, digits, dots and hyphens). Returns its tags and the project's, with counts.",
    inputSchema: object({ work, add: titles(), remove: titles() }, ['work']), run: (root, input) => tagWork(root, input.work!, { add: input.add as string[] | undefined, remove: input.remove as string[] | undefined }),
  },
  {
    name: 'work_search', description: "Find the project's work items, archived included, by tags (all of them) and words in their titles, summaries and tags.",
    inputSchema: object({ query: { type: 'string' }, tags: titles(), status: { type: 'string', enum: ['open', 'closed', 'all'] } }),
    run: async (root, input) => ({ planningFolder: root, work: await searchWork(root, { query: input.query as string | undefined, tags: input.tags as string[] | undefined, status: input.status as 'open' | 'closed' | 'all' | undefined }) }),
  },
  {
    name: 'work_accept', description: 'Record that the user agreed to the plan: design accepted today, planning steps done.',
    inputSchema: object({ work }, ['work']), run: (root, input) => acceptWork(root, input.work!),
  },
  {
    name: 'work_start',
    description: 'Start implementing an accepted plan: its agreed steps (one per meaningful deliverable) go after the planning steps as todo, replacing the proposed ones; without steps, the proposed steps become them. Commit the plan first.',
    inputSchema: object({ work, steps: { ...titles(), minItems: 1 } }, ['work']), run: (root, input) => startWork(root, input.work!, { steps: input.steps as string[] | undefined }),
  },
  {
    name: 'step',
    description: "Change the ledger's steps. add: append todo steps when agreed scope grows (planning steps before work_start, implementation steps after). propose: while planning, replace the plan's proposed implementation steps (shown as proposed until work_start). set: move a step to todo, doing or done as work on it starts or finishes. rename: retitle a step, keeping its place and status. remove: drop a step that was transferred or dropped; tell the user why.",
    inputSchema: object({ work, action: { type: 'string', enum: Object.keys(stepFields) }, steps: titles('For add and propose.'), step: { type: 'string', description: 'For set, rename and remove: the title as the ledger has it.' }, status: { type: 'string', enum: ['todo', 'doing', 'done'], description: 'For set.' }, to: { type: 'string', description: 'For rename: the new title.' } }, ['work', 'action']),
    run: (root, input) => {
      const action = stepAction(input);
      if (action === 'add') return addSteps(root, input.work!, input.steps as string[]);
      if (action === 'propose') return proposeSteps(root, input.work!, input.steps as string[]);
      if (action === 'set') return setStepStatus(root, input.work!, input.step as string, input.status as LedgerStepStatus);
      if (action === 'rename') return renameStep(root, input.work!, input.step as string, input.to as string);
      return removeStep(root, input.work!, input.step as string);
    },
  },
  {
    name: 'work_block', description: 'Set blocked to the reason the work cannot go on; without a reason, clear it.',
    inputSchema: object({ work, reason: { type: 'string' } }, ['work']),
    run: (root, input) => setBlocked(root, input.work!, (input.reason as string | undefined) || null),
  },
  {
    name: 'work_continue',
    description: 'Record the work a work item continues (the handoff), replacing what was recorded; an empty list records none. Both plans and ledgers then link it.',
    inputSchema: object({ work, continues }, ['work', 'continues']),
    run: (root, input) => setContinues(root, input.work!, input.continues as string[]),
  },
  {
    name: 'work_parts',
    description: 'Set the work items a work item is made of (its parts, other work of this project), in order, replacing them: to reorder, add existing work or take a part out; an empty list removes them. Groups are one level deep, and a part belongs to one group.',
    inputSchema: object({ work, parts: titles('Its parts in order, such as ["work-0034", "work-0035"].') }, ['work', 'parts']),
    run: (root, input) => setParts(root, input.work!, input.parts as string[]),
  },
  {
    name: 'work_close', description: 'Close finished work, once its outcome is reached and the user confirms it, or handed you the work to finish without them: refused with the open items unless every step is done and nothing is blocked; then complete today and moved to archive/.',
    inputSchema: object({ work }, ['work']), run: (root, input) => closeWork(root, input.work!),
  },
  {
    name: 'work_archive',
    description: 'Move work to archive/ without closing it. Unfinished work needs a disposition: superseded (supersededBy names the replacement) or abandoned (the reason goes into the plan\'s Outcome). Close finished work with work_close.',
    inputSchema: object({ work, disposition: { type: 'string', enum: ['superseded', 'abandoned'] }, supersededBy: { ...work, description: 'The work item that replaces it; naming it implies superseded.' }, reason: { type: 'string' } }, ['work']),
    run: (root, input) => archiveWork(root, input.work!, { disposition: (input.disposition as 'superseded' | 'abandoned' | undefined) ?? null, supersededBy: (input.supersededBy as string | undefined) ?? null, reason: (input.reason as string | undefined) ?? null }),
  },
  {
    name: 'work_reopen', description: 'Reopen archived work: back to active/, in progress, with the new steps as todo.',
    inputSchema: object({ work, steps: titles() }, ['work', 'steps']), run: (root, input) => reopenWork(root, input.work!, { steps: input.steps as string[] }),
  },
];

/**
 * `where` for the agent: the work's folder only when its plan does not name it, the tags of the
 * matching projects, and the other projects' summaries only when no project matches, as the agent
 * then chooses among them.
 */
async function leanWhere(where: Whereabouts) {
  const matches = await Promise.all(where.matches.map(async match => {
    const tags = await projectTags(match.planningFolder).catch(() => ({}));
    return { ...match, work: match.work.map(({ path: folder, ...item }) => item.plan?.startsWith(folder + '/') ? item : { path: folder, ...item }), ...Object.keys(tags).length && { tags } };
  }));
  const projects = matches.length ? where.projects.map(({ work, ...project }) => work ? { ...project, work: work.map(({ summary: _, ...item }) => item) } : project) : where.projects;
  return { ...where, matches, projects };
}

/** Tools that change only a work item's steps or blocked: their result is the ledger's state. */
const ledgerTools = new Set(['step', 'work_block']);

/** What the agent needs after a call: the ledger's state after a step change, the status without statistics after a lifecycle change. */
function shaped(name: string, value: unknown) {
  if (name === 'work_status' || !value || typeof value !== 'object' || !('statistics' in value)) return value;
  const { statistics: _, changed, warnings, ...status } = value as WorkResult;
  const notes = warnings.length ? { warnings } : {};
  if (ledgerTools.has(name)) return { planningFolder: status.planningFolder, workId: status.workId, steps: status.steps, progress: status.progress, blocked: status.blocked, ...notes };
  if (name === 'work_tag') return { planningFolder: status.planningFolder, workId: status.workId, tags: status.tags, projectTags: (value as unknown as { projectTags: unknown }).projectTags, ...notes };
  return { ...status, changed, ...notes };
}

/** Tools about the home rather than one planning folder. */
const homeTools = new Set(['where', 'project_create', 'needs_you']);

/** Run a tool call; a refusal is a tool error the agent can read and act on. */
export async function callTool(name: string, input: Arguments) {
  const tool = tools.find(item => item.name === name);
  if (!tool) return { isError: true, content: [{ type: 'text', text: 'Unknown tool: ' + name }] };
  try {
    const base = input.cwd && path.isAbsolute(input.cwd) ? input.cwd : process.cwd();
    const root = homeTools.has(name) ? '' : await resolvePlanningFolder({ planningFolder: input.planningFolder, cwd: base, work: input.work ?? null });
    const value = shaped(name, await tool.run(root, { ...input, cwd: base }));
    return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> };
  } catch (error) {
    if (!(error instanceof WorkError || error instanceof PlanningNotFoundError || error instanceof DatabaseVersionError)) throw error;
    const problems = error instanceof WorkError ? error.problems : [];
    return { isError: true, content: [{ type: 'text', text: [error.message, ...problems.map(item => '- ' + item)].join('\n') }] };
  }
}

export function createMcpServer() {
  const server = new Server({ name: 'atlas', version }, { capabilities: { tools: {} }, instructions });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }));
  // The first tool call notes which agent uses Atlas's tools (by the name its client gave), once:
  // the app warns when an agent's sessions use them but its hooks never run.
  let noted = false;
  server.setRequestHandler(CallToolRequestSchema, async request => {
    if (!noted) {
      noted = true;
      const agent = agentOfClient(server.getClientVersion()?.name);
      if (agent) noteActivity(atlasHome(undefined, process.env), agent, 'mcp');
    }
    return callTool(request.params.name, (request.params.arguments ?? {}) as Arguments) as never;
  });
  return server;
}

/** Serve until the harness closes stdin. */
export async function serveMcp(args: string[], out: Output) {
  const line = 'Usage: atlas mcp';
  if (wantsHelp(args)) { out.stdout(line); return 0; }
  const { positional } = parseOptions(args, { values: [] }, line);
  if (positional.length) throw new UsageError('unrecognized arguments: ' + positional.join(' '), line);
  await createMcpServer().connect(new StdioServerTransport(process.stdin, process.stdout));
  return 0;
}
