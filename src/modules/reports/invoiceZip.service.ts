import { PassThrough } from 'node:stream';
import { ZipArchive } from 'archiver';

export async function zipBuffers(
  entries: Array<{ name: string; buffer: Buffer }>,
): Promise<Buffer> {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const stream = new PassThrough();
  const chunks: Buffer[] = [];

  const done = new Promise<Buffer>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    archive.on('error', reject);
  });

  archive.pipe(stream);
  for (const entry of entries) {
    archive.append(entry.buffer, { name: entry.name });
  }
  await archive.finalize();
  return done;
}
