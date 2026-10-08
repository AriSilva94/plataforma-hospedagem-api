import { NestFactory } from '@nestjs/core';
import { configureApplication } from './app.config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApplication(app);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3030);
}
void bootstrap();
