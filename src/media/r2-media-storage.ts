import {
  DeleteObjectsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { EnvironmentService } from '../infrastructure/environment/environment.service';
import { MediaObject, MediaStorage } from './media-storage';

type R2Connection = { client: S3Client; bucket: string };

@Injectable()
export class R2MediaStorage extends MediaStorage implements OnModuleDestroy {
  private connection?: R2Connection;

  constructor(private readonly environmentService: EnvironmentService) {
    super();
  }

  async put({ key, body, contentType, sizeBytes }: MediaObject) {
    const { client, bucket } = this.connect();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: sizeBytes,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async delete(keys: string[]) {
    if (keys.length === 0) {
      return;
    }
    const { client, bucket } = this.connect();
    const result = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.map((key) => ({ Key: key })), Quiet: true },
      }),
    );
    if (result.Errors?.length) {
      throw new Error(
        `Falha ao remover ${result.Errors.length} objeto(s) do R2.`,
      );
    }
  }

  publicUrl(key: string) {
    const baseUrl = this.environmentService
      .getOrThrow('R2_PUBLIC_BASE_URL')
      .replace(/\/+$/, '');
    return `${baseUrl}/${key}`;
  }

  onModuleDestroy() {
    this.connection?.client.destroy();
  }

  private connect(): R2Connection {
    this.connection ??= {
      client: new S3Client({
        region: 'auto',
        endpoint: this.environmentService.getOrThrow('R2_ENDPOINT'),
        forcePathStyle: true,
        credentials: {
          accessKeyId: this.environmentService.getOrThrow('R2_ACCESS_KEY_ID'),
          secretAccessKey: this.environmentService.getOrThrow(
            'R2_SECRET_ACCESS_KEY',
          ),
        },
      }),
      bucket: this.environmentService.getOrThrow('R2_BUCKET'),
    };
    return this.connection;
  }
}
