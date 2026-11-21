// What a window shows while it waits for something it reads: nothing at first, since most waits are
// over before anyone would notice them, then a small spinner with what it waits for, in the middle of
// the window's body.
import { useEffect, useState } from 'react';
import { Spinner } from '@envsemble/envui';

/** How long a wait stays blank before it says what it waits for. */
const quiet = 600;

/** Whether a wait has gone on for `after` milliseconds since this component appeared. */
export function useLongWait(after = quiet) {
  const [long, setLong] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLong(true), after);
    return () => clearTimeout(timer);
  }, [after]);
  return long;
}

export function Loading({ label }: { label: string }) {
  const shown = useLongWait();
  return <div className="page-state page-loading" aria-busy="true" aria-label={label}>
    {shown && <Spinner size="sm" label={label} showLabel />}
  </div>;
}
