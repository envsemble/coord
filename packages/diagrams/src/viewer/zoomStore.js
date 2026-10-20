// The camera's readout changes every few frames. Subscribe just the readout,
// rather than pushing every rounded percentage through the whole application.
export function createZoomStore() {
  let zoom = 100;
  const listeners = new Set();
  return {
    getSnapshot: () => zoom,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(value) {
      if (value === zoom) return;
      zoom = value;
      listeners.forEach((listener) => listener());
    },
  };
}
