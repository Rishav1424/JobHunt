import { Redis } from 'ioredis';
import { config } from './config';
import { logger } from './logger';

// BullMQ dedicated connections (maxRetriesPerRequest: null is required by BullMQ)
export const redisConnection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const redisSubscriber = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// General-purpose Redis client (for circuit breaker, feedback signals, caching)
export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 500, 5000),
});

redisConnection.on('connect', () => logger.info('✅ Redis connected'));
redisConnection.on('error', (err) => logger.error('Redis error', { err }));
redis.on('error', (err) => logger.error('Redis (general) error', { err }));
