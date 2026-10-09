// Domain errors let the controller map a failure to an HTTP response by kind
// instead of by message text. Config errors surface at boot; request errors
// are the caller's fault (400); generation errors carry consumer-actionable
// detail (500 with message); anything else is hidden behind a generic message.
export class ContentSchemasConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentSchemasConfigError';
  }
}

export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRequestError';
  }
}

export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationError';
  }
}

export const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
