// A work item's statistics as its About sidebar shows them, and the parts the Statistics page shares:
// the implementing model with its provider's mark and the other models quietly below it, agent
// time (counting up while agents work) and tokens with what they stand for on hover and focus, the
// time and tokens of planning and implementation, the subagents that worked, and plan revisions.
import { Fragment } from 'react';
import { Build } from '@envsemble/envui/icons/Build';
import { EditNote } from '@envsemble/envui/icons/EditNote';
import { Help } from '@envsemble/envui/icons/Help';
import { Schedule } from '@envsemble/envui/icons/Schedule';
import { SmartToy } from '@envsemble/envui/icons/SmartToy';
import { Token } from '@envsemble/envui/icons/Token';
import type { AgentUsage, ModelUsage, TokenKinds } from '@envsemble/atlas/planning/types';
import { CommitIcon } from '../ui/icons';
import type { Work, WorkStatistics } from '../types';
import { aiModel, providerNames } from '../ui/aiModels';
import { ProviderMark } from '../ui/AiModel';
import { Detailed } from '../ui/ui';
import { compactNumber, duration, plural } from '../ui/format';
import { agentTimeNote, modelShare, otherModels, shownStages, stageLabels, stageUsage, tokenRows, tokenText, type StageKey } from './workStatistics';
import { unreported, type LiveActivity } from './agentTime';
import { AgentTime, measuredSection, modelName, shortId, type AgentTotals, type ReportSection } from './LiveAgentTime';

const stageIcons: Record<StageKey, typeof Build> = { planning: EditNote, implementation: Build, unknown: Help };

function Breakdown({ rows, total }: { rows: { label: string; value: string }[]; total: { label: string; value: string } }) {
  return <dl className="breakdown">
    {rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
    <div className="breakdown-total"><dt>{total.label}</dt><dd>{total.value}</dd></div>
  </dl>;
}

/** Tokens by kind, for a tooltip. */
export function TokenBreakdown({ usage }: { usage: { tokens: number | null; tokenKinds: TokenKinds | null } }) {
  return <Breakdown rows={tokenRows(usage).map(row => ({ label: row.label, value: compactNumber(row.value) }))} total={{ label: 'Total', value: (usage.tokens ?? 0).toLocaleString() }} />;
}

/** How many agents a report names before it sums up the rest. */
const agentsNamed = 5;
const agentLabel = (agent: AgentUsage) => [agent.subagent ? 'Subagent ' + shortId(agent.subagent) : agent.session ? 'Session ' + shortId(agent.session) : 'Session not recorded', agent.model && aiModel(agent.model).name].filter(Boolean).join(' · ');

/** The subagent that stands for those older reports counted without naming them. */
const unlisted = 'unlisted';

/**
 * Agent time by agent: the busiest named, then the rest in one row, so the rows add up to the agent
 * time. The rest is the agents listed beyond those named, and the subagents older reports counted
 * without naming them (`unlisted`, as many as the subagents counted but not named); when it is only
 * those, it says so.
 */
function byAgent(statistics: WorkStatistics): ReportSection {
  const listed = statistics.agents.filter(agent => agent.subagent !== unlisted), named = listed.slice(0, agentsNamed);
  if (!statistics.agents.length) return { rows: [] };
  const unnamed = statistics.agents.some(agent => agent.subagent === unlisted) ? Math.max(1, (statistics.subagents?.count ?? 0) - listed.filter(agent => agent.subagent !== null).length) : 0;
  const more = listed.length - named.length;
  const rest = Math.max(0, statistics.agentMs - named.reduce((sum, agent) => sum + agent.agentMs, 0));
  const label = more && unnamed ? more + unnamed + ' more' : more ? more + ' more' : unnamed ? plural(unnamed, 'unnamed subagent') : 'No agent named';
  return { heading: 'By agent', rows: [
    ...named.map(agent => ({ label: agentLabel(agent), value: duration(agent.agentMs) })),
    ...more || unnamed || rest >= 30_000 ? [{ label, value: duration(rest) }] : [],
  ] };
}

/** What a work item's agent time report knows beyond the totals: by agent, by model and by stage. */
function agentTimeSections(statistics: WorkStatistics): ReportSection[] {
  return [
    byAgent(statistics),
    { heading: 'By model', rows: statistics.models.filter(model => model.agentMs > 0).map(model => ({ label: modelName(model.model), value: duration(model.agentMs) })) },
    { heading: 'By stage', rows: shownStages(statistics).map(stage => ({ label: stageLabels[stage], value: duration(stageUsage(statistics, stage)!.agentMs) })) },
  ];
}

/** A model's title: its identifier, provider and what it did. */
const modelTitle = (model: ModelUsage) => {
  const provider = aiModel(model.model).provider;
  return [model.model, provider && providerNames[provider], modelShare(model)].filter(Boolean).join(' · ');
};

/** "with A", "with A and B", "with A and 2 more": the other models, named quietly. */
function OtherModels({ statistics }: { statistics: WorkStatistics }) {
  const others = otherModels(statistics);
  if (!others.length) return null;
  const named = others.length > 2 ? others.slice(0, 1) : others, rest = others.slice(named.length);
  // Lines break between models, never inside a name.
  return <span className="work-statistics-others">{named.map((model, index) => <Fragment key={model.model}>{index ? ' ' : ''}<span className="nowrap">{index ? 'and ' : 'with '}<span title={modelTitle(model)}>{aiModel(model.model).name}</span></span></Fragment>)}
    {rest.length > 0 && <> <span className="nowrap" title={rest.map(modelTitle).join('\n')}>and {rest.length} more</span></>}
  </span>;
}

/**
 * `activity`: what agents do on the work item now, so its agent time counts up while they work, on
 * top of the project listing's totals (`totals`), which come with the activity; the folder's
 * statistics, read apart, give the rest.
 */
export function WorkStatisticsSummary({ work, statistics, activity = null, totals }: { work: Work; statistics: WorkStatistics; activity?: LiveActivity | null; totals?: AgentTotals | null }) {
  const primary = statistics.models.find(model => model.model === statistics.primaryModel);
  const model = primary && aiModel(primary.model);
  return <div className="work-statistics">
    {primary && model && <div className="work-statistics-model">
      <ProviderMark provider={model.provider} />
      <span className="work-statistics-primary" title={modelTitle(primary)}>{model.name}</span>
      <OtherModels statistics={statistics} />
    </div>}
    <ul className="work-statistics-facts">
      {(statistics.reports > 0 || unreported(activity)) && <li><Schedule className="work-statistics-icon" />
        <AgentTime totals={totals ?? statistics} activity={activity} sections={agentTimeSections(statistics)} after={[measuredSection(statistics)]} description={agentTimeNote(statistics)} strong />
        <span className="muted">of agent time</span></li>}
      {statistics.tokens !== null && <li><Token className="work-statistics-icon" /><Detailed detail={<TokenBreakdown usage={statistics} />} description={tokenText(statistics)}><strong>{compactNumber(statistics.tokens)}</strong></Detailed><span className="muted">tokens</span></li>}
      {shownStages(statistics).map(stage => {
        const usage = stageUsage(statistics, stage)!, Icon = stageIcons[stage];
        return <li key={stage} className="work-statistics-stage" title={usage.tokens !== null ? tokenText(usage) : undefined}><Icon className="work-statistics-icon" /><strong>{duration(usage.agentMs)}</strong><span className="muted">{stageLabels[stage].toLowerCase()}{usage.tokens !== null ? ' · ' + compactNumber(usage.tokens) + ' tokens' : ''}</span></li>;
      })}
      {statistics.subagents?.count ? <li title="Subagents, and their working time: each one's own, added up"><SmartToy className="work-statistics-icon" /><strong>{statistics.subagents.count}</strong><span className="muted">{statistics.subagents.count === 1 ? 'subagent' : 'subagents'} · {duration(statistics.subagents.agentMs)}</span></li> : null}
      {statistics.planRevisions !== null && <li title={work.completed ? 'Commits that changed the plan before completion' : 'Commits that changed the plan so far'}><CommitIcon className="work-statistics-icon" /><strong>{statistics.planRevisions}</strong><span className="muted">{statistics.planRevisions === 1 ? 'plan revision' : 'plan revisions'}</span></li>}
    </ul>
  </div>;
}
