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
import { MAX_VIDEO_BYTES } from './media-file';

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

export const UploadMedia = () =>
  applyDecorators(
    UseInterceptors(
      FileInterceptor('file', {
        storage: diskStorage({}),
        limits: { fileSize: MAX_VIDEO_BYTES, files: 1, fields: 0 },
      }),
      RemoveUploadedFileInterceptor,
    ),
  );
