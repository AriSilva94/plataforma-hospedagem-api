import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UseInterceptors,
  applyDecorators,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { rm } from 'fs/promises';
import { diskStorage } from 'multer';
import { finalize } from 'rxjs';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from './media-file';

@Injectable()
class RemoveUploadedFileInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      finalize(() => {
        if (request.file?.path) {
          void rm(request.file.path, { force: true });
        }
      }),
    );
  }
}

const uploadMedia = (fileSize: number) =>
  applyDecorators(
    UseInterceptors(
      FileInterceptor('file', {
        storage: diskStorage({}),
        limits: { fileSize, files: 1, fields: 0 },
      }),
      RemoveUploadedFileInterceptor,
    ),
  );

export const UploadImage = () => uploadMedia(MAX_IMAGE_BYTES);
export const UploadPropertyMedia = () => uploadMedia(MAX_VIDEO_BYTES);
