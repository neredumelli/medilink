import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { config } from './config';

// Load settings from apps/api/.env (Node 20.12+ built-in, no extra package needed).
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file: rely on real environment variables (production) */
}

async function bootstrap() {
  const cfg = config(); // fails fast with a clear message if .env is incomplete
  // rawBody is needed to verify sync-agent signatures
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: cfg.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true });
  app.enableShutdownHooks();

  const doc = new DocumentBuilder()
    .setTitle('MediLink API')
    .setDescription('B2B ordering for pharmacies, distributors and sales reps. Money values are integer paise.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));

  await app.listen(cfg.API_PORT);
  Logger.log(`API ready on http://localhost:${cfg.API_PORT}/api  (docs: /api/docs)`, 'MediLink');
}

bootstrap();
