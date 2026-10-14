// A work item's statistics as its About sidebar shows them, and the parts the Statistics page shares:
// the implementing model with its provider's mark and the other models quietly below it, agent
// time and tokens with what they stand for on hover and focus, the time and tokens of planning and
// implementation, the subagents that worked, and plan revisions.
import { Fragment, useId, type ReactNode } from 'react';
import { Tooltip } from '@envsemble/envui';
import { Build } from '@envsemble/envui/icons/Build';
import { EditNote } from '@envsemble/envui/icons/EditNote';
import { Help } from '@envsemble/envui/icons/Help';
import { Schedule } from '@envsemble/envui/icons/Schedule';
import { SmartToy } from '@envsemble/envui/icons/SmartToy';
import { Token } from '@envsemble/envui/icons/Token';
import type { ModelUsage, TokenKinds } from '@envsemble/atlas-planning/types';
import { CommitIcon } from './icons';
import type { Work, WorkStatistics } from './types';
import { aiModel, providerNames } from './aiModels';
import { ProviderMark } from './AiModel';
import { absoluteDate, compactNumber, duration } from './format';
import { agentTimeNote, modelShare, otherModels, shownStages, stageLabels, stageUsage, timeSource, tokenRows, tokenText, type StageKey } from './workStatistics';

const stageIcons: Record<StageKey, typeof Build> = { planning: EditNote, implementation: Build, unknown: Help };

/** A value with more to say: shown on hover and focus, and read as the value's description. */
export function Detailed({ children, detail, description }: { children: ReactNode; detail: ReactNode; description: string }) {
  const id = useId();
  return <>
    <Tooltip content={detail}><span className="detailed" tabIndex={0} aria-describedby={id}>{children}</span></Tooltip>
    <span id={id} hidden>{description}</span>
  </>;
}

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

/** Agent time as measured and estimated, and since when, for a tooltip. */
export function AgentTimeBreakdown({ statistics }: { statistics: WorkStatistics }) {
  if (timeSource(statistics) !== 'mixed') return <>{agentTimeNote(statistics)}</>;
  return <div className="breakdown-note">
    <Breakdown rows={[{ label: 'Measured from logs', value: duration(statistics.measuredMs) }, { label: 'Estimated from reports', value: duration(statistics.estimatedMs) }]} total={{ label: 'Agent time', value: duration(statistics.agentMs) }} />
    {statistics.firstReport && <p>Since {absoluteDate(statistics.firstReport)}</p>}
  </div>;
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

export function WorkStatisticsSummary({ work, statistics }: { work: Work; statistics: WorkStatistics }) {
  const primary = statistics.models.find(model => model.model === statistics.primaryModel);
  const model = primary && aiModel(primary.model);
  return <div className="work-statistics">
    {primary && model && <div className="work-statistics-model">
      <ProviderMark provider={model.provider} />
      <span className="work-statistics-primary" title={modelTitle(primary)}>{model.name}</span>
      <OtherModels statistics={statistics} />
    </div>}
    <ul className="work-statistics-facts">
      {statistics.reports > 0 && <li><Schedule className="work-statistics-icon" /><Detailed detail={<AgentTimeBreakdown statistics={statistics} />} description={agentTimeNote(statistics)}><strong>{duration(statistics.agentMs)}</strong></Detailed><span className="muted">of agent time</span></li>}
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
