import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.js';

// Loads backend/.env (if present) and validates every setting at boot.
export const AppConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  validate: validateEnv,
});
