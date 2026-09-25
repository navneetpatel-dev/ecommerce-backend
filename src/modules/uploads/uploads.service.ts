import { AppError } from '@core/errors';
import { ValidationError } from '@core/errors/ValidationError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import {
  isS3Configured,
  publicObjectUrl,
  signedGetObjectUrl,
  signedPutObjectUrl,
  uploadObject,
} from '@config/s3';
import {
  assertValidEntityPurpose,
  assertValidUploadContentType,
  assertValidUploadSize,
  buildS3Key,
  parseDataUrl,
  type S3EntityType,
  type S3Purpose,
} from '@core/s3';
import type {
  PresignBulkRequest,
  PresignSingleRequest,
  UploadBulkRequest,
  UploadFileInput,
  UploadSingleRequest,
} from './uploads.dto';
import { assertUploadAllowed, isPrivateUploadPurpose } from './uploadAuthorization';

export type BulkUploadFileResult =
  | { index: number; url: string; viewUrl?: string; error?: undefined }
  | { index: number; url?: undefined; error: string };

type UploadActor = {
  id: string;
  vendorId: string | null;
  deliveryAgentId: string | null;
  role: { name: string };
  roleId: string;
};

function userFacingUploadError(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof ValidationError) {
    const details = error.details;
    if (details && typeof details === 'object') {
      const parts = Object.values(details as Record<string, unknown>)
        .flatMap((v) => (Array.isArray(v) ? v : [v]))
        .map(String)
        .filter(Boolean);
      if (parts.length) return parts.join('; ');
    }
  }
  if (error instanceof ForbiddenError) return error.message;
  return ERROR_MESSAGES.UPLOAD_FAILED;
}

function ensureS3Ready(): void {
  if (!isS3Configured()) {
    throw new AppError(ERROR_MESSAGES.S3_NOT_CONFIGURED, 503, ERROR_CODES.S3_NOT_CONFIGURED);
  }
}

function resolveFilename(file: UploadFileInput, extensionHint: string): string {
  if (file.filename?.trim()) return file.filename.trim();
  return `upload.${extensionHint}`;
}

async function buildUploadTarget(input: {
  entityType: S3EntityType;
  entityId: string;
  purpose: S3Purpose;
  filename: string;
}) {
  try {
    assertValidEntityPurpose(input.entityType, input.purpose);
  } catch {
    throw new ValidationError({
      purpose: [ERROR_MESSAGES.UPLOAD_INVALID_PURPOSE],
    });
  }

  const key = buildS3Key(
    input.entityType,
    input.entityId,
    input.purpose,
    input.filename,
  );
  const url = publicObjectUrl(key);
  const privateObject = isPrivateUploadPurpose(input.purpose);
  return { key, url, privateObject };
}

async function withViewUrl(
  key: string,
  url: string,
  privateObject: boolean,
): Promise<{ url: string; viewUrl?: string }> {
  if (!privateObject) return { url };
  const viewUrl = await signedGetObjectUrl(key);
  return { url, viewUrl };
}

async function uploadOneFile(input: {
  entityType: S3EntityType;
  entityId: string;
  purpose: S3Purpose;
  file: UploadFileInput;
}): Promise<{ url: string; viewUrl?: string; key: string }> {
  let parsed: ReturnType<typeof parseDataUrl>;
  try {
    parsed = parseDataUrl(input.file.dataUrl);
  } catch {
    throw new ValidationError({ dataUrl: [ERROR_MESSAGES.UPLOAD_INVALID_DATA_URL] });
  }

  assertValidUploadContentType(
    input.entityType,
    input.purpose,
    parsed.contentType,
  );
  assertValidUploadSize(
    input.entityType,
    input.purpose,
    parsed.buffer.byteLength,
    parsed.contentType,
  );

  const { key, url, privateObject } = await buildUploadTarget({
    entityType: input.entityType,
    entityId: input.entityId,
    purpose: input.purpose,
    filename: resolveFilename(input.file, parsed.extensionHint),
  });

  await uploadObject({
    key,
    body: parsed.buffer,
    contentType: parsed.contentType,
    privateObject,
  });

  const result = await withViewUrl(key, url, privateObject);
  return { ...result, key };
}

class UploadsService {
  private async authorize(
    actor: UploadActor,
    entityType: S3EntityType,
    entityId: string,
    purpose: S3Purpose,
  ) {
    await assertUploadAllowed(actor, entityType, entityId, purpose);
  }

  /**
   * Phase 1 — pre-signed PUT URL. Client uploads directly, then uses returned `url` in Phase 2.
   */
  async presignSingle(actor: UploadActor, data: PresignSingleRequest) {
    ensureS3Ready();
    await this.authorize(actor, data.entityType as S3EntityType, data.entityId, data.purpose as S3Purpose);

    assertValidUploadContentType(
      data.entityType as S3EntityType,
      data.purpose as S3Purpose,
      data.contentType,
    );
    assertValidUploadSize(
      data.entityType as S3EntityType,
      data.purpose as S3Purpose,
      data.contentLength,
      data.contentType,
    );

    const { key, url, privateObject } = await buildUploadTarget({
      entityType: data.entityType as S3EntityType,
      entityId: data.entityId,
      purpose: data.purpose as S3Purpose,
      filename: data.filename,
    });

    const uploadUrl = await signedPutObjectUrl(key, data.contentType, data.contentLength);
    const result = await withViewUrl(key, url, privateObject);
    return { uploadUrl, ...result, key };
  }

  async presignBulk(actor: UploadActor, data: PresignBulkRequest) {
    ensureS3Ready();
    await this.authorize(actor, data.entityType as S3EntityType, data.entityId, data.purpose as S3Purpose);

    const results: Array<
      | { index: number; uploadUrl: string; url: string; viewUrl?: string; key: string }
      | { index: number; error: string }
    > = [];

    for (let index = 0; index < data.files.length; index += 1) {
      const file = data.files[index]!;
      try {
        assertValidUploadContentType(
          data.entityType as S3EntityType,
          data.purpose as S3Purpose,
          file.contentType,
        );
        assertValidUploadSize(
          data.entityType as S3EntityType,
          data.purpose as S3Purpose,
          file.contentLength,
          file.contentType,
        );

        const { key, url, privateObject } = await buildUploadTarget({
          entityType: data.entityType as S3EntityType,
          entityId: data.entityId,
          purpose: data.purpose as S3Purpose,
          filename: file.filename,
        });
        const uploadUrl = await signedPutObjectUrl(key, file.contentType, file.contentLength);
        const view = await withViewUrl(key, url, privateObject);
        results.push({ index, uploadUrl, ...view, key });
      } catch (error) {
        results.push({
          index,
          error: userFacingUploadError(error),
        });
      }
    }

    return {
      items: results.filter((r): r is Extract<typeof r, { uploadUrl: string }> => 'uploadUrl' in r),
      errors: results
        .filter((r): r is Extract<typeof r, { error: string }> => 'error' in r)
        .map((r) => ({ index: r.index, message: r.error })),
    };
  }

  /** Phase 1 server-side upload (data URL) — kept for compatibility. */
  async uploadSingle(actor: UploadActor, data: UploadSingleRequest): Promise<{ url: string; viewUrl?: string }> {
    ensureS3Ready();
    await this.authorize(actor, data.entityType as S3EntityType, data.entityId, data.purpose as S3Purpose);

    const result = await uploadOneFile({
      entityType: data.entityType as S3EntityType,
      entityId: data.entityId,
      purpose: data.purpose as S3Purpose,
      file: data.file,
    });
    return { url: result.url, viewUrl: result.viewUrl };
  }

  async uploadBulk(actor: UploadActor, data: UploadBulkRequest): Promise<{
    urls: string[];
    viewUrls: string[];
    errors: Array<{ index: number; message: string }>;
  }> {
    ensureS3Ready();
    await this.authorize(actor, data.entityType as S3EntityType, data.entityId, data.purpose as S3Purpose);

    const urls: string[] = [];
    const viewUrls: string[] = [];
    const errors: Array<{ index: number; message: string }> = [];

    for (let index = 0; index < data.files.length; index += 1) {
      const file = data.files[index]!;
      try {
        const result = await uploadOneFile({
          entityType: data.entityType as S3EntityType,
          entityId: data.entityId,
          purpose: data.purpose as S3Purpose,
          file,
        });
        urls.push(result.url);
        viewUrls.push(result.viewUrl ?? result.url);
      } catch (error) {
        errors.push({ index, message: userFacingUploadError(error) });
      }
    }

    return { urls, viewUrls, errors };
  }
}

export const uploadsService = new UploadsService();
