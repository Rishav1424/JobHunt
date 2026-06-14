import { createLogger, format, transports } from 'winston';
import { config } from './config';

export const logger = createLogger({
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.colorize({ all: config.NODE_ENV !== 'production' }),
    format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `${timestamp} [${level}]: ${message}${metaStr}`;
    })
  ),
  transports: [
    new transports.Console(),
    ...(config.NODE_ENV === 'production'
      ? [new transports.File({ filename: 'logs/error.log', level: 'error' }),
         new transports.File({ filename: 'logs/combined.log' })]
      : []),
  ],
});
