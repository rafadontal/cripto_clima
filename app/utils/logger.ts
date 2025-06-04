import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  defaultMeta: { service: 'resumotube-api' },
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.timestamp(),
        format.printf(({ timestamp, level, message, service, ...meta }) => {
          return `${timestamp} [${level}] [${service}]: ${message} ${
            Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
          }`;
        })
      )
    })
  ]
});

export const logApiRequest = (req: Request, res: Response, next?: () => void) => {
  const start = Date.now();
  const { method, url } = req;
  
  // Log request start
  logger.info('API Request started', {
    method,
    url,
    timestamp: new Date().toISOString()
  });

  // If this is an Express middleware
  if (res.on) {
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info('API Request completed', {
        method,
        url,
        statusCode: res.statusCode,
        duration: `${duration}ms`
      });
    });
  }

  if (next) next();
};

export default logger; 