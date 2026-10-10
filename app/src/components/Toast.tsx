// Short-lived notices in the corner of the window.
import { useCallback, useRef, useState } from 'react';
import { XIcon } from '@primer/octicons-react';

export interface Toast { id: number; message: string; tone: 'info' | 'warning' | 'danger' }

export function useToasts(timeout = 7000) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const dismiss = useCallback((id: number) => setToasts(current => current.filter(item => item.id !== id)), []);
  const notify = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = ++next.current;
    setToasts(current => [...current.slice(-3), { id, message, tone }]);
    window.setTimeout(() => dismiss(id), tone === 'info' ? timeout : timeout * 2);
  }, [dismiss, timeout]);
  return { toasts, notify, dismiss };
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss(id: number): void }) {
  return <div className="toasts" role="status" aria-live="polite">
    {toasts.map(toast => <div key={toast.id} className={'toast toast-' + toast.tone}>
      <span>{toast.message}</span>
      <button type="button" className="btn-octicon" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}><XIcon size={16} /></button>
    </div>)}
  </div>;
}
