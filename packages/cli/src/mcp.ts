// `atlas mcp`: the planning-state operations for an agent harness, over stdio. The same operations
// as the work commands, called in-process. Prose (plans, ledger notes, glossaries) and diagrams are
// files agents edit directly, so there are no tools for them.
import { createRequire } from 'node:module';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  acceptWork, addSteps, archiveWork, closeWork, createWork, findPlanning, PlanningNotFoundError, removeStep, renameStep, reopenWork,
  resolvePlanningFolder, setBlocked, setStepStatus, startWork, WorkError, workStatus, type LedgerStepStatus,
} from '@envsemble/atlas-planning';
import { parseOptions, UsageError, wantsHelp, type Output } from './args.ts';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const instructions = 'Atlas keeps plans in planning folders in the Atlas home (~/.atlas/planning). Find the planning folder and active work for your checkout with where. '
  + 'Change planning state only through these tools: create a work item (ask the user first, and only for work big enough to plan), accept its design, start implementation with its steps, '
  + 'update steps and blocked as work moves, and close it when every step is done. Edit plan prose, ledger notes, glossaries and diagrams directly as files in the planning folder. The tools never commit; commit planning changes yourself.';

const planningFolder = { type: 'string', description: 'Absolute path of the planning folder. Omit it to use the one your checkout belongs to.' };
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
    description: 'Find the planning folder (an absolute path in the Atlas home) for a checkout, by its Git remotes, and the active work for its repositories with their steps and blocked. Call it first when you need the plan or ledger of your work.',
    inputSchema: { type: 'object', properties: { cwd }, additionalProperties: false },
    run: (_, input) => findPlanning(input.cwd!),
  },
  {
    name: 'work_status', description: 'A work item\'s plan statuses and dates, ledger steps, blocked, and a summary of its statistics.',
    inputSchema: object({ work }, ['work']), run: (root, input) => workStatus(root, input.work!),
  },
  {
    name: 'work_create',
    description: 'Create and register a work item: the next free number, active/NNNN-slug/plan.md with a draft plan header, and its planning.json entry. Ask the user before creating one: only work big enough to plan needs it. Then write the plan body in plan.md directly.',
    inputSchema: object({ title: { type: 'string', description: 'The work\'s title.' }, repositories: titles('Registered repository IDs the work applies to. Omit them to use the repositories your checkout is.'), slug: { type: 'string', description: 'Folder name after the number (lowercase, hyphens); derived from the title when omitted.' } }, ['title']),
    run: async (root, input) => {
      let repositories = input.repositories as string[] | undefined;
      if (!repositories?.length) repositories = (await findPlanning(input.cwd ?? process.cwd())).matches.find(match => match.planningFolder === root)?.repositories ?? [];
      return createWork(root, { title: input.title as string, repositories, slug: (input.slug as string | undefined) ?? null });
    },
  },
  {
    name: 'work_accept', description: 'Record that the user accepted the design: design_status accepted, accepted_at today. Only when the user has agreed to the plan.',
    inputSchema: object({ work }, ['work']), run: (root, input) => acceptWork(root, input.work!),
  },
  {
    name: 'work_start',
    description: 'Start implementing an accepted plan: implementation in progress, and a ledger with these steps (one per meaningful deliverable or milestone, all todo) and the plan\'s Git revision. Commit the plan first.',
    inputSchema: object({ work, steps: { ...titles('The agreed steps, in order.'), minItems: 1 } }, ['work', 'steps']), run: (root, input) => startWork(root, input.work!, { steps: input.steps as string[] }),
  },
  {
    name: 'step_add', description: 'Add steps (todo) to the end of the ledger, when agreed scope gains them.',
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
    name: 'step_remove', description: 'Remove a ledger step that was transferred or dropped; the reason is written into the ledger. Never drop an agreed step without one.',
    inputSchema: object({ work, step: title, reason: { type: 'string', description: 'Why it is removed, and where it went if it was transferred.' } }, ['work', 'step', 'reason']),
    run: (root, input) => removeStep(root, input.work!, input.step as string, input.reason as string),
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
    description: 'Move a work folder from active/ to archive/ without closing it, repairing links. Work that is not complete needs a disposition: superseded (name the work that replaces it) or abandoned (give the reason); it becomes the plan\'s design_status, and the reason goes into the ledger. Finished work is closed with work_close instead.',
    inputSchema: object({
      work, disposition: { type: 'string', enum: ['superseded', 'abandoned'], description: 'Why the work stops: replaced by other work, or dropped.' },
      supersededBy: { ...work, description: 'For superseded work: the work item that replaces it.' }, reason: { type: 'string', description: 'Why; required for abandoned work.' },
    }, ['work']),
    run: (root, input) => archiveWork(root, input.work!, { disposition: (input.disposition as 'superseded' | 'abandoned' | undefined) ?? null, supersededBy: (input.supersededBy as string | undefined) ?? null, reason: (input.reason as string | undefined) ?? null }),
  },
  {
    name: 'work_reopen', description: 'Reopen archived work: back to active/, implementation in progress, with the new steps as todo.',
    inputSchema: object({ work, steps: titles('The steps that reopen it.') }, ['work', 'steps']), run: (root, input) => reopenWork(root, input.work!, { steps: input.steps as string[] }),
  },
];

/** Run a tool call; a refusal is a tool error the agent can read and act on. */
export async function callTool(name: string, input: Arguments) {
  const tool = tools.find(item => item.name === name);
  if (!tool) return { isError: true, content: [{ type: 'text', text: 'Unknown tool: ' + name }] };
  try {
    const base = input.cwd && path.isAbsolute(input.cwd) ? input.cwd : process.cwd();
    const root = name === 'where' ? '' : await resolvePlanningFolder({ planningFolder: input.planningFolder, cwd: base, work: input.work ?? null });
    const value = await tool.run(root, { ...input, cwd: base });
    return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> };
  } catch (error) {
    if (!(error instanceof WorkError || error instanceof PlanningNotFoundError)) throw error;
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
