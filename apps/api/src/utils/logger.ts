import winston from "winston";

const { combine, timestamp, printf, colorize } = winston.format;

const customFormat = printf(({ level, message, timestamp: ts, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `${ts} [${level}]: ${message}${metaStr}`;
});

// GCP Cloud Logging severity mapping for production JSON format
const gcpSeverity = winston.format((info) => {
  const severityMap: Record<string, string> = {
    error: "ERROR",
    warn: "WARNING",
    info: "INFO",
    debug: "DEBUG",
  };
  info.severity = severityMap[info.level] ?? "DEFAULT";
  return info;
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
    process.env.NODE_ENV === "production"
      ? combine(gcpSeverity(), winston.format.json())
      : combine(colorize(), customFormat),
  ),
  transports: [transport],
});

/** Create a service-scoped child logger with a `service` field. */
export function createServiceLogger(serviceName: string): winston.Logger {
  return logger.child({ service: serviceName });
}

/**
 * Create a logger that downgrades `info` → `debug` while preserving other levels.
 * Useful for passing to noisy libraries (e.g. quickdraw-core ServiceRegistry)
 * so their method-call logs only appear at LOG_LEVEL=debug.
 */
export function createDowngradedLogger(): {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  child: (options: Record<string, unknown>) => ReturnType<typeof createDowngradedLogger>;
} {
  const downgraded = {
    info: (msg: string, meta?: Record<string, unknown>) => logger.debug(msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) => logger.warn(msg, meta),
    error: (msg: string, meta?: Record<string, unknown>) => logger.error(msg, meta),
    debug: (msg: string, meta?: Record<string, unknown>) => logger.debug(msg, meta),
    child: () => downgraded,
  };
  return downgraded;
}

/** Extract structured error metadata from an unknown error value. */
export function errorMeta(error: unknown): { message: string; stack?: string; code?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      ...("code" in error && typeof error.code === "string" ? { code: error.code } : {}),
    };
  }
  return { message: String(error) };
}

export default logger;
