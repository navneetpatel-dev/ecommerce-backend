import { randomUUID } from 'crypto';
import { env } from '@config/env';
import {
  S3_ENTITY_PURPOSES,
  type S3EntityType,
  type S3Purpose,
} from './constants';

/**
 * Builds a hierarchical S3 object key.
 * Pattern: `{env}/{entity-type}/{entityId}/{purpose}/{uuid}.{ext}`
 *
 * Never embeds the original client filename — only its extension is used.
 * Every upload path in the app must call this; do not hand-build keys.
 */
export function buildS3Key(
  entityType: S3EntityType,
  entityId: string,
  purpose: S3Purpose,
  filename: string,
): string {
  assertValidEntityPurpose(entityType, purpose);
  const id = safeEntityId(entityId);

  const ext = extensionFromFilename(filename);
  return `${env.NODE_ENV}/${entityType}/${id}/${purpose}/${randomUUID()}.${ext}`;
}

/** Prefix covering all objects for a parent entity (cascade delete). */
export function buildS3EntityPrefix(entityType: S3EntityType, entityId: string): string {
  const id = safeEntityId(entityId);
  return `${env.NODE_ENV}/${entityType}/${id}/`;
}

/**
 * The entity id becomes a key segment, so it must not be able to leave its own
 * prefix: `abc/../<other-id>` or `abc/purpose/x` would write under another entity.
 */
function safeEntityId(entityId: string): string {
  const id = entityId.trim();
  if (!id) {
    throw new Error('entityId is required to build an S3 key');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('entityId may only contain letters, digits, "-" and "_"');
  }
  return id;
}

export function assertValidEntityPurpose(entityType: S3EntityType, purpose: S3Purpose): void {
  const allowed = S3_ENTITY_PURPOSES[entityType];
  if (!allowed?.includes(purpose)) {
    throw new Error(`Purpose "${purpose}" is not valid for entity type "${entityType}"`);
  }
}

export function extensionFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop()?.trim() || 'bin';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return 'bin';
  const ext = base
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return ext || 'bin';
}
