/** Short human description of a storage error. */
export function describeError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'QuotaExceededError') return 'the browser storage is full';
  if (name === 'InvalidStateError' || name === 'UnknownError') return 'the browser storage is unavailable (private mode?)';
  const m = (e as Error)?.message;
  return m ? m.slice(0, 120) : 'unknown error';
}
