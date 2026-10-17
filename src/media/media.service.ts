import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { open } from 'fs/promises';
import sharp from 'sharp';
import { Readable } from 'stream';
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
    const inspected = await inspectFile(file, allowedTypes);
    const { format } = inspected;

    const sanitizedImage =
      format.type === MediaType.IMAGE
        ? await sanitizeImage(inspected.file.path, format.extension)
        : undefined;
    const storedSize = sanitizedImage?.length ?? inspected.file.size;
    if (storedSize > maxBytesFor(format.type)) {
      throw new PayloadTooLargeException(
        `O arquivo excede o limite de ${maxBytesFor(format.type) / (1024 * 1024)} MB.`,
      );
    }

    const folder = format.type === MediaType.IMAGE ? 'images' : 'videos';
    const storageKey = `assets/${folder}/${keyPrefix}/${randomUUID()}.${format.extension}`;
    await this.storage.put({
      key: storageKey,
      body: sanitizedImage
        ? Readable.from([sanitizedImage])
        : createReadStream(inspected.file.path),
      contentType: format.mimeType,
      sizeBytes: storedSize,
    });

    return {
      type: format.type,
      storageKey,
      mimeType: format.mimeType,
      sizeBytes: storedSize,
    };
  }

  async typeOf(
    file: UploadedMediaFile | undefined,
    allowedTypes: readonly MediaType[],
  ): Promise<MediaType> {
    return (await inspectFile(file, allowedTypes)).format.type;
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
    return this.publicUrl(cover?.storageKey ?? null);
  }

  publicUrl(storageKey: string | null): string | null {
    return storageKey ? this.storage.publicUrl(storageKey) : null;
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

async function inspectFile(
  file: UploadedMediaFile | undefined,
  allowedTypes: readonly MediaType[],
) {
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
  return { file, format };
}

async function sanitizeImage(path: string, expectedExtension: string) {
  try {
    const { data, info } = await sharp(path, { animated: true })
      .rotate()
      .toBuffer({ resolveWithObject: true });
    const decodedExtension = info.format === 'jpeg' ? 'jpg' : info.format;
    if (decodedExtension !== expectedExtension) {
      throw new Error('Formato decodificado não corresponde ao cabeçalho.');
    }
    return data;
  } catch {
    throw new BadRequestException(
      'A imagem está corrompida ou contém dados inválidos.',
    );
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
