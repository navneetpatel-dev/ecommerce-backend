import { ERROR_CODES, ERROR_MESSAGES, type ErrorCode } from '@core/constants/errors';
import type { AppError } from '@core/errors';
import {
  validationDetailsMessage,
  type ValidationErrorDetails,
} from '@core/http/validationErrorDetails';

const INTERNAL_ERROR_PATTERNS = [
  /\b(?:backend|frontend|infra|src|node_modules)\//i,
  /\b(?:README|\.md|\.ts|\.tsx|\.json)\b/i,
  /\barn:aws:[a-z0-9-]*:[a-z0-9-]*:/i,
  /\bs3:[A-Z][a-zA-Z]+/,
  /\bAWS_[A-Z0-9_]+\b/,
  /\bIAM\b/i,
  /\bat\s+[\w./<>-]+\(\d+:\d+\)/,
  /AccessDenied/i,
  /not authorized to perform/i,
  /Configure\s+[A-Z_]+/,
  /See\s+\S+\/README/i,
];

/** Codes → safe client message. Auto-filled where ERROR_CODES and ERROR_MESSAGES share a key. */
const CODE_TO_PUBLIC_MESSAGE: Partial<Record<ErrorCode, string>> = {};

for (const key of Object.keys(ERROR_CODES) as Array<keyof typeof ERROR_CODES>) {
  const code = ERROR_CODES[key];
  const message = ERROR_MESSAGES[key as keyof typeof ERROR_MESSAGES];
  if (typeof message === 'string') {
    CODE_TO_PUBLIC_MESSAGE[code] = message;
  }
}

Object.assign(CODE_TO_PUBLIC_MESSAGE, {
  [ERROR_CODES.UNAUTHORIZED]: ERROR_MESSAGES.AUTH_REQUIRED,
  [ERROR_CODES.FORBIDDEN]: ERROR_MESSAGES.FORBIDDEN,
  [ERROR_CODES.NOT_FOUND]: ERROR_MESSAGES.NOT_FOUND,
  [ERROR_CODES.CONFIG_ERROR]: ERROR_MESSAGES.INTERNAL_ERROR,
  [ERROR_CODES.INVALID_REFRESH_TOKEN]: ERROR_MESSAGES.INVALID_TOKEN,
  [ERROR_CODES.REFRESH_TOKEN_EXPIRED]: ERROR_MESSAGES.TOKEN_EXPIRED,
});

const KNOWN_SAFE_MESSAGES = new Set<string>(Object.values(ERROR_MESSAGES));

function isKnownSafeMessage(message: string): boolean {
  return KNOWN_SAFE_MESSAGES.has(message.trim());
}

export function looksLikeInternalErrorMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return INTERNAL_ERROR_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Safe message for API clients (Postman, Swagger, web). Full text stays in logs only. */
export function publicErrorMessage(code: string, internalMessage: string, details?: unknown): string {
  if (code === ERROR_CODES.VALIDATION_ERROR && details && typeof details === 'object') {
    const validationMessage = validationDetailsMessage(details as ValidationErrorDetails);
    if (validationMessage !== 'Validation failed') {
      const sanitized = sanitizePublicString(validationMessage);
      if (sanitized) return sanitized;
    }
  }

  if (code === ERROR_CODES.FORBIDDEN) {
    const trimmed = internalMessage.trim();
    if (trimmed && isKnownSafeMessage(trimmed)) return trimmed;
    return ERROR_MESSAGES.FORBIDDEN;
  }

  const mapped = CODE_TO_PUBLIC_MESSAGE[code as ErrorCode];
  if (mapped) return mapped;

  const trimmed = internalMessage.trim();
  if (!trimmed || looksLikeInternalErrorMessage(trimmed)) {
    return ERROR_MESSAGES.INTERNAL_ERROR;
  }

  return trimmed;
}

function sanitizePublicString(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (looksLikeInternalErrorMessage(trimmed)) return undefined;
  return trimmed;
}

/** Strip internal strings from validation/details payloads before sending to clients. */
export function sanitizePublicDetails(details: unknown): unknown {
  if (details == null) return undefined;

  if (typeof details === 'string') {
    return sanitizePublicString(details);
  }

  if (Array.isArray(details)) {
    const items = details
      .map((item) => sanitizePublicDetails(item))
      .filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }

  if (typeof details === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
      const sanitized = sanitizePublicDetails(value);
      if (sanitized !== undefined) {
        out[key] = sanitized;
      }
    }
    return Object.keys(out).length ? out : undefined;
  }

  return details;
}

export function toPublicErrorBody(err: AppError): {
  code: string;
  message: string;
  details?: unknown;
} {
  const details = sanitizePublicDetails(err.details);
  return {
    code: err.code,
    message: publicErrorMessage(err.code, err.message, err.details),
    ...(details !== undefined ? { details } : {}),
  };
}
