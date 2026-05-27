import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: 'https://invoice.thethrottle.in',
    credentials: true,
  });

  const port = Number(process.env.PORT) || 4000;

  await app.listen(port, '127.0.0.1');

  console.log(`Backend running on http://localhost:${port}`);
}

bootstrap();
