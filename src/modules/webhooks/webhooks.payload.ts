/**
 * Webhook payload helpers (no server imports — directly unit-testable).
 */

/** Parse the raw-body SES event (registered with express.raw) into an object. */
export function parseSesEventBody(body: unknown): unknown {
  return Buffer.isBuffer(body) ? JSON.parse(body.toString('utf8')) : body;
}
