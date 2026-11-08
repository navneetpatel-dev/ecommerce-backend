import { z } from 'zod';

/**
 * A missing field reads "Required", as it did before zod 4 (whose default is
 * "Invalid input: expected string, received undefined"). Clients show these
 * messages next to the field, so they stay short. Schema-specific messages win.
 */
z.config({
  customError: (issue) => (issue.code === 'invalid_type' && issue.input === undefined ? 'Required' : undefined),
});
