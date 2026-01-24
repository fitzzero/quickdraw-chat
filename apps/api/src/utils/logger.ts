import winston from "winston";

const { combine, timestamp, printf, colorize } = winston.format;

const customFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `${timestamp} [${level}]: ${message}${metaStr}`;
});

// MCP mode: write all logs to stderr to avoid corrupting JSON-RPC on stdout
const isMcpMode = process.env.MCP_MODE === "true";

// Create transport - use Stream to stderr in MCP mode for guaranteed stderr output
const transport = isMcpMode
  ? new winston.transports.Stream({ stream: process.stderr })
  : new winston.transports.Console();

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: combine(
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    process.env.NODE_ENV === "production" ? winston.format.json() : combine(colorize(), customFormat)
  ),
  transports: [transport],
});

export default logger;
