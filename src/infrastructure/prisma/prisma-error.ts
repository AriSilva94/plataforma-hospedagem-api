export function isUniqueConstraintError(error: unknown): boolean {
  return hasErrorCode(error, 'P2002');
}

export function isRecordNotFoundError(error: unknown): boolean {
  return hasErrorCode(error, 'P2025');
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}
