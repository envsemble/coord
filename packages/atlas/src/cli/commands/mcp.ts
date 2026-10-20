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
  acceptWork, addSteps, archiveWork, closeWork, createWork, findPlanning, DatabaseVersionError, PlanningNotFoundError, removeStep, renameStep, reopenWork, setContinues,
  resolvePlanningFolder, setBlocked, setStepStatus, startWork, WorkError, workStatus, type LedgerStepStatus,
} from '../../planning/index.ts';
import type { Whereabouts } from '../../planning/projects/findProject.ts';
import type { WorkResult } from '../../planning/work/work.ts';
import { parseOptions, UsageError, wantsHelp, type Output } from '../args.ts';
import { createHomeProject } from './planning.ts';

const require = createRequire(import.meta.url);
const { version } = require('../../../package.json') as { version: string };

const instructions = "Atlas keeps plans in projects: planning folders in the Atlas home (~/.atlas/planning). A session in one of a project's folders (the deepest wins when they nest), or in its planning folder, belongs to that project; where lists the projects and their active work. "
  + 'When several projects match, ask the user which one to plan in and pass its planningFolder; when none does, ask which project the work belongs to. '
  + 'Ask the user before project_create or work_create, and open work items only for work big enough to plan; small tasks stay plain coding. '
  + 'Change planning state (work items, steps, blocked, closing, archiving) only through these tools; edit plan prose, glossaries and diagrams directly as files in the planning folder. '
  + 'When work continues other work (follow-ups moved off work that is closing, a next phase), record the handoff with continues. '
  + 'In planning files, write PRs and issues as owner/repo#N and commits as owner/repo@hash (or their URLs), naming the repository yourself, so Atlas links them. '
  + 'When you stop to wait for the user, begin your message with the question or decision you need. The tools never commit; commit planning changes yourself.';

const planningFolder = { type: 'string', description: "The project's planning folder; needed only when several projects or none cover your folder." };
const cwd = { type: 'string', description: "Your folder, when it isn't the session's." };
const work = { type: 'string', pattern: '^work-[0-9]{4,}$' };
const title = { type: 'string', description: 'As the ledger has it.' };
const titles = (description?: string) => ({ type: 'array', items: { type: 'string' }, ...description && { description } });
const continues = titles("Work items it continues: work-0023, or project:work-0023 in another project (its planning folder's name).");
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: { ...properties, planningFolder, cwd }, required, additionalProperties: false });

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
    name: 'project_create',
    description: 'Create a project in the Atlas home: a planning folder, its own Git repository, covering the folders given. Check with where that none covers them yet.',
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
    description: 'Create a work item: active/NNNN-slug/ with a draft plan.md (its header holds the summary) and a ledger with the planning steps (Understand the request, doing; Settle the design; Write the plan; Accepted). Then write the plan body directly, and keep the summary and planning steps true as the design settles.',
    inputSchema: object({ title: { type: 'string' }, summary: { type: 'string', description: 'Two or three plain sentences, on one line: what the work is, why, and where it stands.' }, slug: { type: 'string', description: 'Folder name after the number; derived from the title by default.' }, continues }, ['title']),
    run: (root, input) => createWork(root, { title: input.title as string, slug: (input.slug as string | undefined) ?? null, summary: (input.summary as string | undefined) ?? null, continues: (input.continues as string[] | undefined) ?? null }),
  },
  {
    name: 'work_accept', description: 'Record that the user agreed to the plan: design accepted today, planning steps done.',
    inputSchema: object({ work }, ['work']), run: (root, input) => acceptWork(root, input.work!),
  },
  {
    name: 'work_start',
    description: 'Start implementing an accepted plan: its agreed steps (one per meaningful deliverable) go after the planning steps as todo. Commit the plan first.',
    inputSchema: object({ work, steps: { ...titles(), minItems: 1 } }, ['work', 'steps']), run: (root, input) => startWork(root, input.work!, { steps: input.steps as string[] }),
  },
  {
    name: 'step_add', description: 'Add todo steps when agreed scope grows: planning steps before work_start, implementation steps after.',
    inputSchema: object({ work, steps: titles() }, ['work', 'steps']), run: (root, input) => addSteps(root, input.work!, input.steps as string[]),
  },
  {
    name: 'step_set', description: 'Set a step to todo, doing or done as work on it starts or finishes.',
    inputSchema: object({ work, step: title, status: { type: 'string', enum: ['todo', 'doing', 'done'] } }, ['work', 'step', 'status']),
    run: (root, input) => setStepStatus(root, input.work!, input.step as string, input.status as LedgerStepStatus),
  },
  {
    name: 'step_rename', description: 'Rename a step, keeping its place and status.',
    inputSchema: object({ work, step: title, to: { type: 'string' } }, ['work', 'step', 'to']),
    run: (root, input) => renameStep(root, input.work!, input.step as string, input.to as string),
  },
  {
    name: 'step_remove', description: 'Remove a step that was transferred or dropped; tell the user why.',
    inputSchema: object({ work, step: title }, ['work', 'step']),
    run: (root, input) => removeStep(root, input.work!, input.step as string),
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
    name: 'work_close', description: 'Close finished work: refused with the open items unless every step is done and nothing is blocked; then complete today and moved to archive/.',
    inputSchema: object({ work }, ['work']), run: (root, input) => closeWork(root, input.work!),
  },
  {
    name: 'work_archive',
    description: 'Move work to archive/ without closing it. Unfinished work needs a disposition: superseded (supersededBy names the replacement) or abandoned (the reason goes into the plan\'s Outcome). Close finished work with work_close.',
    inputSchema: object({ work, disposition: { type: 'string', enum: ['superseded', 'abandoned'] }, supersededBy: work, reason: { type: 'string' } }, ['work']),
    run: (root, input) => archiveWork(root, input.work!, { disposition: (input.disposition as 'superseded' | 'abandoned' | undefined) ?? null, supersededBy: (input.supersededBy as string | undefined) ?? null, reason: (input.reason as string | undefined) ?? null }),
  },
  {
    name: 'work_reopen', description: 'Reopen archived work: back to active/, in progress, with the new steps as todo.',
    inputSchema: object({ work, steps: titles() }, ['work', 'steps']), run: (root, input) => reopenWork(root, input.work!, { steps: input.steps as string[] }),
  },
];

/**
 * `where` for the agent: the work's folder only when its plan does not name it, and the other
 * projects' summaries only when no project matches, as the agent then chooses among them.
 */
function leanWhere(where: Whereabouts) {
  const matches = where.matches.map(match => ({ ...match, work: match.work.map(({ path: folder, ...item }) => item.plan?.startsWith(folder + '/') ? item : { path: folder, ...item }) }));
  const projects = matches.length ? where.projects.map(({ work, ...project }) => work ? { ...project, work: work.map(({ summary: _, ...item }) => item) } : project) : where.projects;
  return { ...where, matches, projects };
}

/** Tools that change only a work item's steps or blocked: their result is the ledger's state. */
const ledgerTools = new Set(['step_add', 'step_set', 'step_rename', 'step_remove', 'work_block']);

/** What the agent needs after a call: the ledger's state after a step change, the status without statistics after a lifecycle change. */
function shaped(name: string, value: unknown) {
  if (name === 'work_status' || !value || typeof value !== 'object' || !('statistics' in value)) return value;
  const { statistics: _, changed, warnings, ...status } = value as WorkResult;
  const notes = warnings.length ? { warnings } : {};
  if (ledgerTools.has(name)) return { workId: status.workId, steps: status.steps, progress: status.progress, blocked: status.blocked, ...notes };
  return { ...status, changed, ...notes };
}

/** Tools about the home rather than one planning folder. */
const homeTools = new Set(['where', 'project_create']);

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
  server.setRequestHandler(CallToolRequestSchema, async request => callTool(request.params.name, (request.params.arguments ?? {}) as Arguments) as never);
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
