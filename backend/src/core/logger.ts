import { createLogger, format, transports } from 'winston';
import Transport from 'winston-transport';
import { config } from './config';

function stripAnsi(str: string): string {
  return typeof str === 'string' ? str.replace(/\u001b\[[0-9;]*m/g, '') : str;
}

class SocketIOTransport extends Transport {
  constructor(opts?: any) {
    super(opts);
  }

  log(info: any, callback: () => void) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    const cleanLevel = stripAnsi(info.level || '');
    const cleanMessage = stripAnsi(info.message || '');
    const timestamp = info.timestamp || new Date().toISOString();
    const { timestamp: _, level: __, message: ___, ...meta } = info;

    const logObj = {
      timestamp,
      level: cleanLevel.trim(),
      message: cleanMessage,
      meta,
    };

    // Publish to Redis for cross-process replication and cache it (max 500 logs)
    import('./redis').then(({ redis }) => {
      if (redis) {
        const logStr = JSON.stringify(logObj);
        redis.multi()
          .lpush('system:logs:cache', logStr)
          .ltrim('system:logs:cache', 0, 499)
          .publish('system:logs:pubsub', logStr)
          .exec()
          .catch(() => {});
      }
    }).catch(() => {});

    callback();
  }
}

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
    new SocketIOTransport(),
    ...(config.NODE_ENV === 'production'
      ? [new transports.File({ filename: 'logs/error.log', level: 'error' }),
         new transports.File({ filename: 'logs/combined.log' })]
      : []),
  ],
});

