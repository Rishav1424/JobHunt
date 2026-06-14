import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  ADZUNA_APP_ID: z.string().optional(),
  ADZUNA_API_KEY: z.string().optional(),
  SERPER_API_KEY: z.string().optional(),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  JWT_SECRET: z.string().default('local-dev-secret'),
  DASHBOARD_PASSWORD: z.string().default('admin'),
  STORAGE_PATH: z.string().default('./storage'),
  CHROMIUM_PATH: z.string().optional(),
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  GMAIL_REFRESH_TOKEN: z.string().optional(),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
