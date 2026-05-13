const pino = require("pino");

const isDev = process.env.NODE_ENV !== "production";

const logger = pino(
  isDev
    ? {
        level: process.env.LOG_LEVEL || "debug",
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname"
          }
        }
      }
    : {
        level: process.env.LOG_LEVEL || "info"
      }
);

module.exports = logger;