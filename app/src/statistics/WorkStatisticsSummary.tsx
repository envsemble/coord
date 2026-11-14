// A work item's headline statistics in the plan's side column: the model that did most of the work, with
// its reasoning effort, and the other models quietly below it; agent time (counting up while agents
// work) and tokens. The rest (by session, model, effort and stage, and the timeline) is on the plan's
// statistics page; a tooltip only says what a figure stands for.
import { Fragment } from 'react';
import { IconSchedule as Schedule } from '@envsemble/envui/icons/Schedule';
import { IconToken as Token } from '@envsemble/envui/icons/Token';
import type { ModelShare } from '@envsemble/coord/planning/types';
import type { WorkStatistics } from '../types';
import { aiModel, providerNames } from '../ui/aiModels';
import { ModelName } from '../ui/ModelName';
import { compactNumber } from '../ui/format';
import { agentTimeNote, modelShare, otherModels } from './workStatistics';
import { unreported, type LiveActivity } from '../plan/agentTime';
import { AgentTime, measuredSection, type AgentTotals } from '../plan/LiveAgentTime';

/** A model's title: its identifier, provider and what it did. */
const modelTitle = (model: ModelShare) => {
  const provider = aiModel(model.model).provider;
  return [model.model, provider && providerNames[provider], modelShare(model)].filter(Boolean).join(' · ');
};

/** "with A", "with A and B", "with A and 2 more": the other models, named quietly. */
function OtherModels({ statistics }: { statistics: WorkStatistics }) {
  const others = otherModels(statistics);
  if (!others.length) return null;
  const named = others.length > 2 ? others.slice(0, 1) : others, rest = others.slice(named.length);
  // Lines break between models, never inside a name.
  return <span className="work-statistics-others">{named.map((model, index) => <Fragment key={model.model}>{index ? ' ' : ''}<span className="nowrap">{index ? 'and ' : 'with '}<ModelName model={model.model} detail={modelShare(model)} /></span></Fragment>)}
    {rest.length > 0 && <> <span className="nowrap" title={rest.map(modelTitle).join('\n')}>and {rest.length} more</span></>}
  </span>;
}

/**
 * `activity`: what agents do on the work item now, so its agent time counts up while they work, on
 * top of the project listing's totals (`totals`), which come with the activity; the folder's
 * statistics, read apart, give the rest.
 */
export function WorkStatisticsSummary({ statistics, activity = null, totals }: { statistics: WorkStatistics; activity?: LiveActivity | null; totals?: AgentTotals | null }) {
  const primary = statistics.models.find(model => model.model === statistics.primaryModel);
  return <div className="work-statistics">
    {primary && <div className="work-statistics-model">
      <ModelName className="work-statistics-primary" model={primary.model} effort={statistics.primaryEffort} detail={modelShare(primary)} />
      <OtherModels statistics={statistics} />
    </div>}
    <ul className="work-statistics-facts">
      {(statistics.reports > 0 || unreported(activity)) && <li><Schedule className="work-statistics-icon" />
        <AgentTime totals={totals ?? statistics} activity={activity} after={[measuredSection(statistics)]} description={agentTimeNote(statistics)} strong />
        <span className="muted">of agent time</span></li>}
      {statistics.tokens !== null && <li><Token className="work-statistics-icon" /><strong>{compactNumber(statistics.tokens)}</strong><span className="muted">tokens</span></li>}
    </ul>
  </div>;
}
