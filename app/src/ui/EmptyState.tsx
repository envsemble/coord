// What a region shows when it has nothing to show, after envUI's empty states pattern: an icon, a
// heading that says what is missing, a sentence on why or what comes next, and at most one action.
import type { ReactNode } from 'react';
import { Column, Text } from '@envsemble/envui';

export function EmptyState({ icon, title, description, action, headingLevel = 2, align = 'start', className }: {
  icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode;
  /** The heading's level, so the state takes its place in the page's outline. */
  headingLevel?: 1 | 2 | 3 | 4;
  align?: 'start' | 'center';
  className?: string;
}) {
  const Heading = `h${headingLevel}` as const;
  return <Column gap={4} padding={5} align={align} className={'empty-state' + (className ? ' ' + className : '')} data-align={align}>
    {icon && <Text render={<span className="empty-state-icon" aria-hidden="true" />} emphasis="muted">{icon}</Text>}
    <Column gap={2} align={align}>
      <Text render={<Heading />} variant="title">{title}</Text>
      {description && <Text render={<div />} variant="body-sm" emphasis="muted">{description}</Text>}
    </Column>
    {action}
  </Column>;
}
