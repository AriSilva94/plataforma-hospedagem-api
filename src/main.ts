import { NestFactory } from '@nestjs/core';
import { configureApplication } from './app.config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApplication(app);
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
