import { Transform, type TransformCallback } from 'node:stream';

/** Passes every chunk through unchanged while counting bytes — used so the
 *  worker can report `byteSize` without ever touching a completed file on
 *  disk (there isn't one). */
export class ByteCountingPassThrough extends Transform {
  bytesWritten = 0;

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.bytesWritten += chunk.length;
    callback(null, chunk);
  }
}
