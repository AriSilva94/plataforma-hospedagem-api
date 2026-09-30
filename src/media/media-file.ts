import { MediaType } from '../generated/prisma/client';

type MediaFormat = {
  mimeType: string;
  extension: string;
  type: MediaType;
  matches: (header: Buffer) => boolean;
};

const MB = 1024 * 1024;

export const MAX_IMAGE_BYTES = 10 * MB;
export const MAX_VIDEO_BYTES = 100 * MB;
export const MEDIA_HEADER_BYTES = 16;

const ascii = (header: Buffer, offset: number, text: string) =>
  header.subarray(offset, offset + text.length).toString('latin1') === text;

const startsWith = (header: Buffer, bytes: number[]) =>
  bytes.every((byte, index) => header[index] === byte);

const mediaFormats: MediaFormat[] = [
  {
    mimeType: 'image/jpeg',
    extension: 'jpg',
    type: MediaType.IMAGE,
    matches: (header) => startsWith(header, [0xff, 0xd8, 0xff]),
  },
  {
    mimeType: 'image/png',
    extension: 'png',
    type: MediaType.IMAGE,
    matches: (header) =>
      startsWith(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    mimeType: 'image/webp',
    extension: 'webp',
    type: MediaType.IMAGE,
    matches: (header) => ascii(header, 0, 'RIFF') && ascii(header, 8, 'WEBP'),
  },
  {
    mimeType: 'video/quicktime',
    extension: 'mov',
    type: MediaType.VIDEO,
    matches: (header) => ascii(header, 4, 'ftypqt  '),
  },
  {
    mimeType: 'video/mp4',
    extension: 'mp4',
    type: MediaType.VIDEO,
    matches: (header) => ascii(header, 4, 'ftyp'),
  },
  {
    mimeType: 'video/webm',
    extension: 'webm',
    type: MediaType.VIDEO,
    matches: (header) => startsWith(header, [0x1a, 0x45, 0xdf, 0xa3]),
  },
];

export function detectMediaFormat(header: Buffer): MediaFormat | undefined {
  return mediaFormats.find((format) => format.matches(header));
}

export function maxBytesFor(type: MediaType): number {
  return type === MediaType.IMAGE ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
}
