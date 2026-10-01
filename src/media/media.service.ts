import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { open } from 'fs/promises';
import { MediaType } from '../generated/prisma/client';
import {
  MEDIA_HEADER_BYTES,
  detectMediaFormat,
  maxBytesFor,
} from './media-file';
import { MediaStorage } from './media-storage';

export type UploadedMediaFile = { path: string; size: number };

export type MediaRecord = StoredMedia & { id: string; position: number };

export type StoredMedia = {
  type: MediaType;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
};

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(private readonly storage: MediaStorage) {}

  async store(
    file: UploadedMediaFile | undefined,
    keyPrefix: string,
    allowedTypes: readonly MediaType[],
  ): Promise<StoredMedia> {
    if (!file) {
      throw new BadRequestException('Envie um arquivo no campo "file".');
    }

    const format = detectMediaFormat(await readHeader(file.path));
    if (!format || !allowedTypes.includes(format.type)) {
      throw new BadRequestException(
        allowedTypes.includes(MediaType.VIDEO)
          ? 'Formato não suportado. Envie imagens JPEG, PNG ou WebP, ou vídeos MP4, MOV ou WebM.'
          : 'Formato não suportado. Envie imagens JPEG, PNG ou WebP.',
      );
    }
    if (file.size <= 0 || file.size > maxBytesFor(format.type)) {
      throw new PayloadTooLargeException(
        `O arquivo excede o limite de ${maxBytesFor(format.type) / (1024 * 1024)} MB.`,
      );
    }

    const folder = format.type === MediaType.IMAGE ? 'images' : 'videos';
    const storageKey = `assets/${folder}/${keyPrefix}/${randomUUID()}.${format.extension}`;
    await this.storage.put({
      key: storageKey,
      body: createReadStream(file.path),
      contentType: format.mimeType,
      sizeBytes: file.size,
    });

    return {
      type: format.type,
      storageKey,
      mimeType: format.mimeType,
      sizeBytes: file.size,
    };
  }

  async removeQuietly(keys: string[]): Promise<void> {
    try {
      await this.storage.delete(keys);
    } catch (error) {
      this.logger.error(
        `Falha ao remover mídia do storage: ${keys.join(', ')}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  toResponse({
    id,
    type,
    storageKey,
    mimeType,
    sizeBytes,
    position,
  }: MediaRecord) {
    return {
      id,
      type,
      url: this.storage.publicUrl(storageKey),
      mimeType,
      sizeBytes,
      position,
    };
  }

  coverUrl(media: Pick<MediaRecord, 'type' | 'storageKey'>[]): string | null {
    const cover = media.find((item) => item.type === MediaType.IMAGE);
    return cover ? this.storage.publicUrl(cover.storageKey) : null;
  }

  assertCompleteOrder(currentIds: string[], requestedIds: string[]): void {
    const current = new Set(currentIds);
    if (
      requestedIds.length !== current.size ||
      !requestedIds.every((id) => current.has(id))
    ) {
      throw new BadRequestException(
        'A nova ordem deve conter exatamente as mídias atuais.',
      );
    }
  }
}

export function nextPosition(existing: { position: number }[]): number {
  return existing.reduce((max, item) => Math.max(max, item.position + 1), 0);
}

async function readHeader(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(MEDIA_HEADER_BYTES);
    const { bytesRead } = await handle.read(header, 0, MEDIA_HEADER_BYTES, 0);
    return header.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
