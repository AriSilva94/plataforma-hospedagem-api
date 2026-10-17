import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { Readable } from 'stream';
import { MediaType } from '../generated/prisma/client';
import { MAX_IMAGE_BYTES } from './media-file';
import { MediaService } from './media.service';
import { MediaObject, MediaStorage } from './media-storage';

const mp4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypisom', 'latin1'),
  Buffer.alloc(4),
]);
const quicktime = Buffer.concat([
  Buffer.from([0, 0, 0, 0x14]),
  Buffer.from('ftypqt  ', 'latin1'),
  Buffer.alloc(4),
]);

describe('MediaService', () => {
  let directory: string;
  let png: Buffer;
  let put: jest.Mock<Promise<void>, [MediaObject]>;
  let service: MediaService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'media-spec-'));
    png = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer();
    put = jest.fn<Promise<void>, [MediaObject]>().mockResolvedValue(undefined);
    const storage: MediaStorage = {
      put,
      delete: jest.fn().mockResolvedValue(undefined),
      publicUrl: (key: string) => `https://cdn.test/${key}`,
    };
    service = new MediaService(storage);
  });

  afterEach(() => rm(directory, { recursive: true, force: true }));

  async function fileWith(content: Buffer, size = content.length) {
    const path = join(directory, `upload-${Math.random()}`);
    await writeFile(path, content);
    return { path, size };
  }

  it('identifica o formato pelo conteúdo e envia ao storage com chave própria', async () => {
    const stored = await service.store(await fileWith(png), 'properties/p1', [
      MediaType.IMAGE,
    ]);

    expect(stored).toMatchObject({
      type: MediaType.IMAGE,
      mimeType: 'image/png',
      sizeBytes: png.length,
    });
    expect(stored.storageKey).toMatch(
      /^assets\/images\/properties\/p1\/[0-9a-f-]{36}\.png$/,
    );
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({
        key: stored.storageKey,
        contentType: 'image/png',
      }),
    );
  });

  it('distingue vídeo MOV de MP4', async () => {
    const mov = await service.store(await fileWith(quicktime), 'p', [
      MediaType.VIDEO,
    ]);
    const video = await service.store(await fileWith(mp4), 'p', [
      MediaType.VIDEO,
    ]);

    expect(mov.mimeType).toBe('video/quicktime');
    expect(mov.storageKey).toMatch(/^assets\/videos\/p\//);
    expect(video.mimeType).toBe('video/mp4');
  });

  it('recusa arquivo cujo conteúdo não é uma mídia suportada', async () => {
    await expect(
      service.store(await fileWith(Buffer.from('<?php echo 1; ?>')), 'p', [
        MediaType.IMAGE,
        MediaType.VIDEO,
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(put).not.toHaveBeenCalled();
  });

  it('remove metadados EXIF com coordenadas GPS antes do storage', async () => {
    const jpeg = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: '#ffffff',
      },
    })
      .jpeg()
      .withExif({
        IFD3: {
          GPSLatitudeRef: 'S',
          GPSLatitude: '23/1 33/1 0/1',
          GPSLongitudeRef: 'W',
          GPSLongitude: '46/1 38/1 0/1',
        },
      })
      .toBuffer();

    await service.store(await fileWith(jpeg), 'properties/p1', [
      MediaType.IMAGE,
    ]);

    const uploaded = put.mock.calls[0][0] as { body: Readable };
    const chunks: Buffer[] = [];
    for await (const chunk of uploaded.body as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const metadata = await sharp(Buffer.concat(chunks)).metadata();
    expect(metadata.exif).toBeUndefined();
  });

  it('recusa arquivo inválido mesmo quando o cabeçalho imita JPEG', async () => {
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);

    await expect(
      service.store(await fileWith(fakeJpeg), 'properties/p1', [
        MediaType.IMAGE,
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(put).not.toHaveBeenCalled();
  });

  it('recusa vídeo onde somente imagens são permitidas', async () => {
    await expect(
      service.store(await fileWith(mp4), 'rooms/r1', [MediaType.IMAGE]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa imagem acima do limite de tamanho', async () => {
    await expect(
      service.store(await fileWith(png, MAX_IMAGE_BYTES + 1), 'p', [
        MediaType.IMAGE,
      ]),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(put).not.toHaveBeenCalled();
  });

  it('exige o arquivo', async () => {
    await expect(
      service.store(undefined, 'p', [MediaType.IMAGE]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('valida que a nova ordem contém exatamente as mídias atuais', () => {
    expect(() =>
      service.assertCompleteOrder(['a', 'b'], ['b', 'a']),
    ).not.toThrow();
    expect(() => service.assertCompleteOrder(['a', 'b'], ['a'])).toThrow(
      BadRequestException,
    );
    expect(() =>
      service.assertCompleteOrder(['a', 'b'], ['a', 'outro']),
    ).toThrow(BadRequestException);
  });

  it('usa a primeira imagem como capa, ignorando vídeos', () => {
    expect(
      service.coverUrl([
        { type: MediaType.VIDEO, storageKey: 'v.mp4' },
        { type: MediaType.IMAGE, storageKey: 'i.png' },
      ]),
    ).toBe('https://cdn.test/i.png');
    expect(service.coverUrl([])).toBeNull();
  });
});
