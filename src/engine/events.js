// Event bus: on(type, fn) returns an unsubscribe function; emit calls listeners in subscription order.
export function createEvents() {
  const map = new Map();
  const events = {
    on(type, fn) {
      if (!map.has(type)) map.set(type, []);
      map.get(type).push(fn);
      return () => events.off(type, fn);
    },
    off(type, fn) {
      const list = map.get(type);
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    emit(type, payload) {
      const list = map.get(type);
      if (!list) return;
      for (const fn of list.slice()) fn(payload, type);
    },
  };
  return events;
}
