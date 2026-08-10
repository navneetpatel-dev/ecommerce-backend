export type AppErrorOptions = {
  /** Original underlying error — logged in full, never sent in API responses. */
  cause?: unknown;
};

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly details?: unknown,
    options?: AppErrorOptions,
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
