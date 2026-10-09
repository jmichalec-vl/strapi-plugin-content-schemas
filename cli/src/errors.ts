// Rejections are `unknown`: a non-Error value (string, undefined) must still
// produce a readable message instead of crashing the error path itself
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
