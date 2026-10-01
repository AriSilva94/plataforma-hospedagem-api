import { Readable } from 'stream';

export type MediaObject = {
  key: string;
  body: Readable;
  contentType: string;
  sizeBytes: number;
};

export abstract class MediaStorage {
  abstract put(object: MediaObject): Promise<void>;
  abstract delete(keys: string[]): Promise<void>;
  abstract publicUrl(key: string): string;
}
