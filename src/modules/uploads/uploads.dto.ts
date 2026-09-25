import { z } from 'zod';
import {
  MAX_BULK_UPLOAD_FILES,
  S3_ENTITY_TYPE_VALUES,
  S3_PURPOSE_VALUES,
} from '@core/s3';

const UploadFileSchema = z.object({
  /** `data:<mime>;base64,...` — same pattern as the former avatar endpoint. */
  dataUrl: z.string().min(1),
  /** Original client filename — used only for extension hint, never stored in the key. */
  filename: z.string().min(1).max(255).optional(),
});

export const UploadSingleSchema = z.object({
  entityType: z.enum(S3_ENTITY_TYPE_VALUES),
  entityId: z.string().min(1).max(128),
  purpose: z.enum(S3_PURPOSE_VALUES),
  file: UploadFileSchema,
});

export const UploadBulkSchema = z.object({
  entityType: z.enum(S3_ENTITY_TYPE_VALUES),
  entityId: z.string().min(1).max(128),
  purpose: z.enum(S3_PURPOSE_VALUES),
  files: z.array(UploadFileSchema).min(1).max(MAX_BULK_UPLOAD_FILES),
});

export const PresignFileSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(128),
  /** Exact byte length of the body that will be PUT — signed into the URL. */
  contentLength: z.number().int().positive(),
});

export const PresignSingleSchema = z.object({
  entityType: z.enum(S3_ENTITY_TYPE_VALUES),
  entityId: z.string().min(1).max(128),
  purpose: z.enum(S3_PURPOSE_VALUES),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(128),
  /** Exact byte length of the body that will be PUT — signed into the URL. */
  contentLength: z.number().int().positive(),
});

export const PresignBulkSchema = z.object({
  entityType: z.enum(S3_ENTITY_TYPE_VALUES),
  entityId: z.string().min(1).max(128),
  purpose: z.enum(S3_PURPOSE_VALUES),
  files: z.array(PresignFileSchema).min(1).max(MAX_BULK_UPLOAD_FILES),
});

export type UploadSingleRequest = z.infer<typeof UploadSingleSchema>;
export type UploadBulkRequest = z.infer<typeof UploadBulkSchema>;
export type UploadFileInput = z.infer<typeof UploadFileSchema>;
export type PresignSingleRequest = z.infer<typeof PresignSingleSchema>;
export type PresignBulkRequest = z.infer<typeof PresignBulkSchema>;
