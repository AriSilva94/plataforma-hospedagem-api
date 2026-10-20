import { Controller, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { MAX_IMAGE_BYTES } from './media-file';
import { UploadImage } from './upload-media.decorator';

@Controller('upload-test')
class UploadTestController {
  calls = 0;

  @Post()
  @UploadImage()
  upload() {
    this.calls += 1;
    return { uploaded: true };
  }
}

describe('UploadImage', () => {
  let app: INestApplication<App>;
  let controller: UploadTestController;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UploadTestController],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    controller = app.get(UploadTestController);
  });

  afterAll(() => app.close());

  it('recusa a foto no parser antes de chamar o controller', async () => {
    await request(app.getHttpServer())
      .post('/upload-test')
      .attach('file', Buffer.alloc(MAX_IMAGE_BYTES + 1), 'large.png')
      .expect(413);

    expect(controller.calls).toBe(0);
  });
});
