export const NETWORK_ERROR_MESSAGE = '通信できませんでした。電波の良い場所でもう一度お試しください。';

export function isNetworkError(error: unknown) {
  if (!error) return false;
  const maybeError = error as { code?: unknown; message?: unknown; name?: unknown; details?: unknown; hint?: unknown; status?: unknown };
  const message = [maybeError.name, maybeError.message, maybeError.details, maybeError.hint, maybeError.code]
    .filter((value) => typeof value === 'string')
    .join(' ');

  if (/fetch|network|timeout|timed out|abort|aborted|offline|internet connection|failed to fetch|network request failed|load failed/i.test(message)) {
    return true;
  }

  return maybeError.status === 408 || maybeError.status === 503 || maybeError.status === 504;
}

export function formatNetworkAwareError(error: unknown, fallback: string) {
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
