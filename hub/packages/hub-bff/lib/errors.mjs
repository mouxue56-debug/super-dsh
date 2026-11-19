export class BffError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}
export const disconnected = () => new BffError('DISCONNECTED', 'DSH connection unavailable');
export function upstreamError(code) {
  if (typeof code !== 'string') return new BffError('UPSTREAM_FAILURE', 'DSH request failed');
  if (code.includes('not-found')) return new BffError('NOT_FOUND', 'Session not found', 404);
  if (code.includes('conflict') || code.includes('busy')) return new BffError('CONFLICT', 'DSH rejected a conflicting operation', 409);
  if (code.includes('arguments-invalid') || code.includes('bad-request')) return new BffError('INVALID_INPUT', 'DSH rejected the request', 400);
  if (code.includes('cancelled')) return new BffError('CANCELLED', 'DSH operation cancelled', 409);
  return new BffError('UPSTREAM_FAILURE', 'DSH request failed');
}
export function publicError(error) {
  return error instanceof BffError ? error : new BffError('UPSTREAM_FAILURE', 'DSH request failed');
}
