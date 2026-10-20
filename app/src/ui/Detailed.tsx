import { useId, type ReactNode } from 'react';
import { Tooltip } from '@envsemble/envui';

/** A value with more to say: shown on hover and focus, and read as the value's description. */
export function Detailed({ children, detail, description }: { children: ReactNode; detail: ReactNode; description: string }) {
  const id = useId();
  return <>
    <Tooltip content={detail}><span className="detailed" tabIndex={0} aria-describedby={id}>{children}</span></Tooltip>
    <span id={id} hidden>{description}</span>
  </>;
}
