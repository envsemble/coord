// The frame of a page: its heading with its controls and its toolbar; and a page for something gone.
import type { ReactNode } from 'react';
import { Text } from '@envsemble/envui';
import { EmptyState } from './EmptyState';
import { Code } from '@envsemble/envui/code';
import { ErrorIcon } from './icons';

export function Page({ title, heading, toolbar, children, className = '' }: { title?: ReactNode; heading?: ReactNode; toolbar?: ReactNode; children: ReactNode; className?: string }) {
  return <div className={'page ' + className}>
    {(title || heading) && <header className="page-header">
      {heading ?? <Text render={<h1 />} variant="title">{title}</Text>}
    </header>}
    {toolbar && <div className="page-toolbar">{toolbar}</div>}
    {children}
  </div>;
}

export function Gone({ title, detail }: { title: string; detail: string }) {
  return <Page><EmptyState className="page-empty" icon={<ErrorIcon />} title={title} description={<Code>{detail}</Code>} /></Page>;
}
