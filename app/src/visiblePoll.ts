/** Serial polling that sleeps in background tabs and resumes immediately on return. */
export function pollWhileVisible(task: (signal: AbortSignal) => Promise<number | null>, visibility: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> = document) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false, finished = false;
  const run = async () => {
    if (controller.signal.aborted || visibility.hidden || running || finished) return;
    clearTimeout(timer);
    running = true;
    try {
      const delay = await task(controller.signal);
      finished = delay === null;
      if (!controller.signal.aborted && !visibility.hidden && delay !== null) timer = setTimeout(run, delay);
    } finally { running = false; }
  };
  const onVisibility = () => { clearTimeout(timer); if (!visibility.hidden) void run(); };
  visibility.addEventListener('visibilitychange', onVisibility);
  void run();
  return () => { controller.abort(); clearTimeout(timer); visibility.removeEventListener('visibilitychange', onVisibility); };
}
