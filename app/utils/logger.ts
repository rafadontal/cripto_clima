type LogLevel = 'info' | 'error' | 'warn' | 'debug';

const log = (level: LogLevel, message: string, meta?: Record<string, any>) => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta
  };
  
  switch (level) {
    case 'error':
      console.error(JSON.stringify(logEntry));
      break;
    case 'warn':
      console.warn(JSON.stringify(logEntry));
      break;
    case 'debug':
      console.debug(JSON.stringify(logEntry));
      break;
    default:
      console.log(JSON.stringify(logEntry));
  }
};

export const logApiRequest = (req: Request) => {
  const { method, url } = req;
  log('info', 'API Request', { method, url });
};

export const logApiResponse = (req: Request, statusCode: number, duration: number) => {
  const { method, url } = req;
  log('info', 'API Response', { method, url, statusCode, duration });
};

export const logError = (error: unknown, context: string) => {
  log('error', 'Error', {
    context,
    error: error instanceof Error ? error.message : 'Unknown error',
    stack: error instanceof Error ? error.stack : undefined
  });
};

export default {
  info: (message: string, meta?: Record<string, any>) => log('info', message, meta),
  error: (message: string, meta?: Record<string, any>) => log('error', message, meta),
  warn: (message: string, meta?: Record<string, any>) => log('warn', message, meta),
  debug: (message: string, meta?: Record<string, any>) => log('debug', message, meta)
}; 