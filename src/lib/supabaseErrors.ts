export function isMissingSupabaseRelationError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { code?: string; message?: string };
  return (
    maybeError.code === 'PGRST205' ||
    maybeError.code === '42P01' ||
    /Could not find the table|schema cache|relation .* does not exist/i.test(maybeError.message ?? '')
  );
}

export function isMissingSupabaseFunctionError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { code?: string; message?: string };
  return (
    maybeError.code === 'PGRST202' ||
    /Could not find the function|schema cache/i.test(maybeError.message ?? '')
  );
}

export function isFutureJwtError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { code?: string; message?: string };
  return maybeError.code === 'PGRST303' || /JWT issued at future/i.test(maybeError.message ?? '');
}
