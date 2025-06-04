"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stream = void 0;
const winston_1 = require("winston");
const logger = (0, winston_1.createLogger)({
    level: 'info',
    format: winston_1.format.combine(winston_1.format.timestamp(), winston_1.format.json()),
    transports: [
        // Write all logs to console
        new winston_1.transports.Console({
            format: winston_1.format.combine(winston_1.format.colorize(), winston_1.format.simple())
        }),
        // Write all logs with level 'error' and below to error.log
        new winston_1.transports.File({
            filename: 'error.log',
            level: 'error',
            format: winston_1.format.combine(winston_1.format.timestamp(), winston_1.format.json())
        }),
        // Write all logs with level 'info' and below to combined.log
        new winston_1.transports.File({
            filename: 'combined.log',
            format: winston_1.format.combine(winston_1.format.timestamp(), winston_1.format.json())
        })
    ]
});
// Create a stream object with a 'write' function that will be used by Morgan
exports.stream = {
    write: (message) => {
        logger.info(message.trim());
    }
};
exports.default = logger;
