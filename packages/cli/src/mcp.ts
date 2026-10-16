// `atlas mcp`: the planning-state operations for an agent harness, over stdio. The same operations
// as the work commands, called in-process. Prose (plans, glossaries, the final-review list) and diagrams are
// files agents edit directly, so there are no tools for them.
import { createRequire } from 'node:module';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  acceptWork, addSteps, archiveWork, closeWork, createWork, findPlanning, DatabaseVersionError, PlanningNotFoundError, removeStep, renameStep, reopenWork,
  resolvePlanningFolder, setBlocked, setStepStatus, startWork, WorkError, workStatus, type LedgerStepStatus, type ProjectRepository,
} from '@envsemble/atlas-planning';
import { parseOptions, UsageError, wantsHelp, type Output } from './args.ts';
import { createHomeProject } from './planning.ts';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const instructions = 'Atlas keeps plans in projects: planning folders in the Atlas home (~/.atlas/planning). Find the projects and active work for your checkout with where, which also lists every active project in the home; '
  + "a session in one of a project's workspace folders belongs to that project. When several projects match, ask the user which one to plan in and pass its planningFolder. "
  + 'Create a project with project_create only when the user asks for one or agrees to it. '
  + 'Change planning state only through these tools: create a work item (ask the user first, and only for work big enough to plan), accept its design, start implementation with its steps, '
  + 'update steps and blocked as work moves, and close it when every step is done. Edit plan prose, glossaries and diagrams directly as files in the planning folder. The tools never commit; commit planning changes yourself.';

const planningFolder = { type: 'string', description: "Absolute path of the project's planning folder. Omit it to use the one your checkout belongs to; give it when several projects register the checkout's repository." };
const cwd = { type: 'string', description: 'Absolute path of the checkout you work in, to find its planning folder. Defaults to the folder the session started in.' };
const work = { type: 'string', description: 'The work item ID, such as work-0012.', pattern: '^work-[0-9]{4,}$' };
const title = { type: 'string', description: 'A step title, exactly as the ledger has it.' };
const titles = (description: string) => ({ type: 'array', items: { type: 'string' }, description });
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: { ...properties, planningFolder, cwd }, required, additionalProperties: false });

interface Arguments { planningFolder?: string; cwd?: string; work?: string; [key: string]: unknown }
interface Tool { name: string; description: string; inputSchema: Record<string, unknown>; run(root: string, input: Arguments): Promise<unknown> }

const tools: Tool[] = [
  {
    name: 'where',
    description: "List every active project in the Atlas home (projects: each planning folder, an absolute path, with its name, repositories, workspace folders, active work as titles, summaries and states, and match: whether the checkout belongs to it), and in matches the projects the checkout belongs to, with the active work for its repositories, their steps and blocked. A folder in one of a project's workspace folders belongs to that project alone (the deepest folder wins); elsewhere a checkout matches the projects that register its Git remotes. Works in any folder, in a Git checkout or not. Call it first when you need the plan or ledger of your work; when several projects match, ask the user which one to plan in; when none does, ask which project the work belongs to, or work across them.",
    inputSchema: { type: 'object', properties: { cwd }, additionalProperties: false },
    run: (_, input) => findPlanning(input.cwd!),
  },
  {
    name: 'project_create',
    description: "Create a project in the Atlas home: a planning folder made from Atlas's templates, as its own Git repository, covering the workspace folders given (a session in one of them belongs to the project) and registering the Git checkouts in them (each folder itself and the folders directly inside it; worktrees count as their repository), unless repositories are given. Ask the user before creating one, and check with where that no project already covers the work. Returns its name, planning folder, workspace folders and repositories, and the checkouts skipped because Git did not answer for them (tell the user).",
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['name', 'workspaces'], properties: {
        name: { type: 'string', description: "The project's name." },
        workspaces: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Absolute paths of the folders on this computer the project covers.' },
        repositories: {
          type: 'array', description: 'The repositories to register instead of the checkouts found in the folders.',
          items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'remote'], properties: { id: { type: 'string', description: 'Lowercase letters and digits joined by hyphens.' }, name: { type: 'string' }, remote: { type: ['string', 'null'], description: 'Its Git remote URL.' } } },
        },
      },
    },
    run: (_, input) => {
      if (!Array.isArray(input.workspaces) || !input.workspaces.length) throw new WorkError('Give the project at least one workspace folder.');
      return createHomeProject({ name: input.name as string, workspaces: input.workspaces as string[], ...input.repositories !== undefined && { repositories: input.repositories as ProjectRepository[] } });
    },
  },
  {
    name: 'work_status', description: 'A work item\'s plan statuses and dates, ledger steps, blocked, and a summary of its statistics.',
    inputSchema: object({ work }, ['work']), run: (root, input) => workStatus(root, input.work!),
  },
  {
    name: 'work_create',
    description: 'Create and register a work item: the next free number, active/NNNN-slug/plan.md with a draft plan header (with its summary), a ledger with the planning steps (Understand the request, doing; Settle the design; Write the plan; Accepted), and its planning.json entry. Ask the user before creating one: only work big enough to plan needs it. Then write the plan body in plan.md directly, keep the summary in its header current as the work moves, and keep the planning steps true while designing (rename, add or remove them to fit the work).',
    inputSchema: object({ title: { type: 'string', description: 'The work\'s title.' }, summary: { type: 'string', description: 'Two or three plain sentences, on one line: what the work is, why, and where it stands.' }, repositories: titles('Registered repository IDs the work applies to. Omit them to use the repositories your checkout is.'), slug: { type: 'string', description: 'Folder name after the number (lowercase, hyphens); derived from the title when omitted.' } }, ['title']),
    run: async (root, input) => {
      let repositories = input.repositories as string[] | undefined;
      if (!repositories?.length) repositories = (await findPlanning(input.cwd ?? process.cwd())).matches.find(match => match.planningFolder === root)?.repositories ?? [];
      return createWork(root, { title: input.title as string, repositories, slug: (input.slug as string | undefined) ?? null, summary: (input.summary as string | undefined) ?? null });
    },
  },
  {
    name: 'work_accept', description: 'Record that the user accepted the design: design_status accepted, accepted_at today, and every planning step done. Only when the user has agreed to the plan.',
    inputSchema: object({ work }, ['work']), run: (root, input) => acceptWork(root, input.work!),
  },
  {
    name: 'work_start',
    description: 'Start implementing an accepted plan: implementation in progress, these steps (one per meaningful deliverable or milestone, all todo) after the planning steps in the ledger. Commit the plan first.',
    inputSchema: object({ work, steps: { ...titles('The agreed steps, in order.'), minItems: 1 } }, ['work', 'steps']), run: (root, input) => startWork(root, input.work!, { steps: input.steps as string[] }),
  },
  {
    name: 'step_add', description: 'Add steps (todo) when agreed scope gains them: before implementation starts they are planning steps (a draft from before planning steps gets its ledger this way), after work_start implementation steps.',
    inputSchema: object({ work, steps: titles('New step titles.') }, ['work', 'steps']), run: (root, input) => addSteps(root, input.work!, input.steps as string[]),
  },
  {
    name: 'step_set', description: 'Set a ledger step to todo, doing or done, as work starts or finishes it.',
    inputSchema: object({ work, step: title, status: { type: 'string', enum: ['todo', 'doing', 'done'] } }, ['work', 'step', 'status']),
    run: (root, input) => setStepStatus(root, input.work!, input.step as string, input.status as LedgerStepStatus),
  },
  {
    name: 'step_rename', description: 'Rename a ledger step, keeping its place and status.',
    inputSchema: object({ work, step: title, to: { type: 'string', description: 'The new title.' } }, ['work', 'step', 'to']),
    run: (root, input) => renameStep(root, input.work!, input.step as string, input.to as string),
  },
  {
    name: 'step_remove', description: 'Remove a ledger step that was transferred or dropped. Never drop an agreed step silently: tell the user why.',
    inputSchema: object({ work, step: title }, ['work', 'step']),
    run: (root, input) => removeStep(root, input.work!, input.step as string),
  },
  {
    name: 'work_block', description: 'Set the ledger\'s blocked to the reason the work cannot go on; call it without a reason to clear blocked once it can.',
    inputSchema: object({ work, reason: { type: 'string', description: 'What blocks the work. Omit it to clear blocked.' } }, ['work']),
    run: (root, input) => setBlocked(root, input.work!, (input.reason as string | undefined) || null),
  },
  {
    name: 'work_close', description: 'Close finished work: refused with the open items unless its ledger has steps, every one done, and nothing is blocked; then implementation complete, completed_at today, and the folder moves to archive/.',
    inputSchema: object({ work }, ['work']), run: (root, input) => closeWork(root, input.work!),
  },
  {
    name: 'work_archive',
    description: 'Move a work folder from active/ to archive/ without closing it, repairing links. Work that is not complete needs a disposition: superseded (name the work that replaces it) or abandoned (give the reason); it becomes the plan\'s design_status, and the reason goes into the plan\'s Outcome. Finished work is closed with work_close instead.',
    inputSchema: object({
      work, disposition: { type: 'string', enum: ['superseded', 'abandoned'], description: 'Why the work stops: replaced by other work, or dropped.' },
      supersededBy: { ...work, description: 'For superseded work: the work item that replaces it. Naming it implies superseded.' }, reason: { type: 'string', description: 'Why; required for abandoned work, and only given with a disposition.' },
    }, ['work']),
    run: (root, input) => archiveWork(root, input.work!, { disposition: (input.disposition as 'superseded' | 'abandoned' | undefined) ?? null, supersededBy: (input.supersededBy as string | undefined) ?? null, reason: (input.reason as string | undefined) ?? null }),
  },
  {
    name: 'work_reopen', description: 'Reopen archived work: back to active/, implementation in progress, with the new steps as todo.',
    inputSchema: object({ work, steps: titles('The steps that reopen it.') }, ['work', 'steps']), run: (root, input) => reopenWork(root, input.work!, { steps: input.steps as string[] }),
  },
];

/** Tools about the home rather than one planning folder. */
const homeTools = new Set(['where', 'project_create']);

/** Run a tool call; a refusal is a tool error the agent can read and act on. */
export async function callTool(name: string, input: Arguments) {
  const tool = tools.find(item => item.name === name);
  if (!tool) return { isError: true, content: [{ type: 'text', text: 'Unknown tool: ' + name }] };
  try {
    const base = input.cwd && path.isAbsolute(input.cwd) ? input.cwd : process.cwd();
    const root = homeTools.has(name) ? '' : await resolvePlanningFolder({ planningFolder: input.planningFolder, cwd: base, work: input.work ?? null });
    const value = await tool.run(root, { ...input, cwd: base });
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
