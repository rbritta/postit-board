/**
 * Rings once for every note whose due time arrives: you decide what ringing means
 * (a chat message, a push notification, an event in a calendar).
 *
 *   const stop = watchDue(store, {
 *     onDue: async (note) => sendMessage(`⏰ ${note.title || note.text}`),
 *   });
 *
 * A note is marked as notified only after `onDue` resolves, so a failure rings again on
 * the next tick. Changing a note's `due` resets it.
 */
export function watchDue(store, { onDue, intervalMs = 60_000, now = () => new Date().toISOString(), onError = console.error } = {}) {
  if (typeof onDue !== 'function') throw new Error('watchDue needs onDue');
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      for (const note of await store.dueNotes(now())) {
        try {
          await onDue(note);
          await store.markNotified(note.id);
        } catch (err) { onError(err); }
      }
    } catch (err) { onError(err); } finally { running = false; }
  }
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  return () => clearInterval(timer);
}
