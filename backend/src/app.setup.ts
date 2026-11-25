import { StandardSchemaValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { type AppConfig, setting } from './config/app-config.js';

// Shared HTTP setup, used by main.ts and the e2e tests so both behave the same.
export function configureApp(app: INestApplication): void {
  const config = app.get<AppConfig>(ConfigService);
  app.use(helmet());
  app.enableCors({ origin: setting(config, 'FRONTEND_ORIGIN'), methods: ['GET'] });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.enableShutdownHooks();
}
