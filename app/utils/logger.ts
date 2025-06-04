type LogLevel = 'info' | 'error' | 'warn' | 'debug';

interface LogContext {
  requestId?: string;
  userId?: string;
  path?: string;
  method?: string;
  [key: string]: any;
}

const getRequestId = () => {
  return Math.random().toString(36).substring(2, 15);
};

const formatLog = (level: LogLevel, message: string, context?: LogContext) => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    requestId: context?.requestId || getRequestId(),
    ...context
  };

  // Remove undefined values
  Object.keys(logEntry).forEach(key => 
    logEntry[key] === undefined && delete logEntry[key]
  );

  return JSON.stringify(logEntry);
};

const log = (level: LogLevel, message: string, context?: LogContext) => {
  const formattedLog = formatLog(level, message, context);
  
  switch (level) {
    case 'error':
      console.error(formattedLog);
      break;
    case 'warn':
      console.warn(formattedLog);
      break;
    case 'debug':
      if (process.env.NODE_ENV !== 'production') {
        console.debug(formattedLog);
      }
      break;
    default:
      console.log(formattedLog);
  }
};

export const createLogger = (context: LogContext = {}) => ({
  info: (message: string, meta?: Record<string, any>) => 
    log('info', message, { ...context, ...meta }),
  
  error: (message: string, error?: unknown, meta?: Record<string, any>) => {
    const errorContext = error instanceof Error ? {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack
    } : { error };
    
    log('error', message, { ...context, ...errorContext, ...meta });
  },
  
  warn: (message: string, meta?: Record<string, any>) => 
    log('warn', message, { ...context, ...meta }),
  
  debug: (message: string, meta?: Record<string, any>) => 
    log('debug', message, { ...context, ...meta })
});

export const logApiRequest = (req: Request, context: LogContext = {}) => {
  const { method, url } = req;
  const requestId = getRequestId();
  
  log('info', 'API Request', {
    ...context,
    requestId,
    method,
    url,
    timestamp: new Date().toISOString()
  });
  
  return requestId;
};

export const logApiResponse = (
  req: Request, 
  statusCode: number, 
  duration: number,
  context: LogContext = {}
) => {
  const { method, url } = req;
  
  log('info', 'API Response', {
    ...context,
    method,
    url,
    statusCode,
    duration: `${duration}ms`
  });
};

export default createLogger(); 