import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  transports: [
    // Write all logs to console
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      )
    }),
    // Write all logs with level 'error' and below to error.log
    new transports.File({ 
      filename: 'error.log', 
      level: 'error',
      format: format.combine(
        format.timestamp(),
        format.json()
      )
    }),
    // Write all logs with level 'info' and below to combined.log
    new transports.File({ 
      filename: 'combined.log',
      format: format.combine(
        format.timestamp(),
        format.json()
      )
    })
  ]
});

// Create a stream object with a 'write' function that will be used by Morgan
export const stream = {
  write: (message: string) => {
    logger.info(message.trim());
  }
};

export default logger; 