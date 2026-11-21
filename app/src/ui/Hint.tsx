import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { Tooltip } from '@envsemble/envui';

/** How long the pointer rests before a hint opens: short, since a hint is looked for. */
const hintDelay = 100;

/**
 * A short hint on hover and keyboard focus, in place of a native `title`: envUI's tooltip, opening
 * quickly. Without anything to say, the element alone. The element gets an empty `title`, so a
 * `title` of something around it does not show beside the hint.
 */
export function Hint({ content, children }: { content: string | null | undefined; children: ReactElement<{ title?: string; children?: ReactNode }> }) {
  return content ? <Tooltip content={content} delay={hintDelay} underline={false}>{cloneElement(children, { title: '' })}</Tooltip> : children;
}
