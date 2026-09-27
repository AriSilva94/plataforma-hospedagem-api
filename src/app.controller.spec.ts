import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('returns the service health status', () => {
      const originalRevision = process.env.APP_REVISION;
      process.env.APP_REVISION = 'test-revision';
      expect(appController.getHealth()).toEqual({
        status: 'ok',
        revision: 'test-revision',
      });
      if (originalRevision === undefined) {
        delete process.env.APP_REVISION;
      } else {
        process.env.APP_REVISION = originalRevision;
      }
    });
  });
});
