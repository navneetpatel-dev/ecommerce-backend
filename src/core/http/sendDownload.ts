import type { Response } from 'express';

/** Send a generated attachment with the headers used by every download endpoint. */
export function sendDownload(
  res: Response,
  file: { buffer: Buffer | string; filename: string; contentType: string },
): void {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(file.buffer);
}

/** Convenience wrapper for the platform's generated PDF documents. */
export function sendPdfDownload(
  res: Response,
  file: { buffer: Buffer; filename: string },
): void {
  sendDownload(res, { ...file, contentType: 'application/pdf' });
}
