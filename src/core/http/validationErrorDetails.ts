export type ValidationErrorDetails = {
  fieldErrors: Record<string, string[]>;
  formErrors: string[];
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function normalizeFieldMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const out: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'formErrors' || key === 'fieldErrors') continue;
    const messages = normalizeStringArray(raw);
    if (messages.length) out[key] = messages;
  }
  return out;
}

/** Normalize string, Zod flatten, or flat field maps into one client shape. */
export function normalizeValidationDetails(input: unknown): ValidationErrorDetails {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    return {
      fieldErrors: {},
      formErrors: trimmed ? [trimmed] : [],
    };
  }

  if (!input || typeof input !== 'object') {
    return { fieldErrors: {}, formErrors: [] };
  }

  const record = input as Record<string, unknown>;

  if ('fieldErrors' in record || 'formErrors' in record) {
    const fieldErrors = normalizeFieldMap(record.fieldErrors);
    const formErrors = normalizeStringArray(record.formErrors);

    for (const [key, raw] of Object.entries(record)) {
      if (key === 'fieldErrors' || key === 'formErrors') continue;
      const messages = normalizeStringArray(raw);
      if (messages.length) fieldErrors[key] = messages;
    }

    return { fieldErrors, formErrors };
  }

  return {
    fieldErrors: normalizeFieldMap(record),
    formErrors: [],
  };
}

export function validationDetailsMessage(details: ValidationErrorDetails): string {
  if (details.formErrors[0]?.trim()) return details.formErrors[0].trim();

  for (const messages of Object.values(details.fieldErrors)) {
    if (messages[0]?.trim()) return messages[0].trim();
  }

  return 'Validation failed';
}
