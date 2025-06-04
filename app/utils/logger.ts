import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message, ...meta }) => {
      // Format that matches Vercel's expected format
      return JSON.stringify({
        timestamp,
        level,
        message,
        ...meta
      });
    })
  ),
  transports: [
    new transports.Console()
  ]
});

// Helper functions for common logging patterns
export const logApiRequest = (req: Request) => {
  const { method, url } = req;
  logger.info('API Request', {
    method,
    url,
    timestamp: new Date().toISOString()
  });
};

export const logApiResponse = (req: Request, statusCode: number, duration: number) => {
  const { method, url } = req;
  logger.info('API Response', {
    method,
    url,
    statusCode,
    duration: `${duration}ms`
  });
};

export const logError = (error: unknown, context: string) => {
  logger.error('Error', {
    context,
    error: error instanceof Error ? error.message : 'Unknown error',
    stack: error instanceof Error ? error.stack : undefined
  });
};

export default logger; 