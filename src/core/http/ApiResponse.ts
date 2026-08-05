export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const ok = <T>(data: T, meta?: Record<string, unknown>): ApiSuccess<T> => ({
  success: true,
  data,
  ...(meta && { meta }),
});
