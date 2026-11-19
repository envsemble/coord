// A page of the window, on envUI's Page and PageHeader: the trail above it in the top left, the title with what goes beside it
// (meta) and under it (description), the page's actions and its toolbar; and a page for something gone.
import type { ReactNode } from 'react';
import { Column, Page as EnvPage, PageHeader } from '@envsemble/envui';
import { Code } from '@envsemble/envui/code';
import { EmptyState } from './EmptyState';
import { ErrorIcon } from './icons';

export function Page({ title, breadcrumbs, meta, description, actions, toolbar, controlSize, width = 'lg', className, children }: {
  title?: ReactNode; breadcrumbs?: ReactNode; meta?: ReactNode; description?: ReactNode; actions?: ReactNode; toolbar?: ReactNode;
  /** sm on a dense page: the toolbar's controls and the actions at the small height. */
  controlSize?: 'sm' | 'md';
  /** envUI's page widths: sm for a form or settings, md for a document, lg for a list (the default), full for a canvas. */
  width?: 'sm' | 'md' | 'lg' | 'full';
  className?: string; children: ReactNode;
}) {
  // The trail sits in the window's top left, as on a page view and in most apps, not in the page's
  // centred column, so it stays put whatever the page's width.
  return <>
    {breadcrumbs != null && <div className="page-trail">{breadcrumbs}</div>}
    <EnvPage className={'page' + (className ? ' ' + className : '')} width={width}
      header={title ? <PageHeader title={title} meta={meta} description={description} actions={actions} toolbar={toolbar} controlSize={controlSize} /> : undefined}>
      <Column gap={5}>{children}</Column>
    </EnvPage>
  </>;
}

export function Gone({ title, detail }: { title: string; detail: string }) {
  return <Page><EmptyState className="page-empty" icon={<ErrorIcon />} title={title} description={<Code>{detail}</Code>} /></Page>;
}
