export type StreamingExportArtifact = {
  tempPath: string;
  contentType: string;
  byteSize: number;
};

export interface StreamingExportWriter {
  writeHeader(): Promise<void>;
  writeRows(rows: Record<string, unknown>[]): Promise<void>;
  finalize(): Promise<StreamingExportArtifact>;
  dispose(): Promise<void>;
}
