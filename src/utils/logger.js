// Shared structured logger — every line carries a timestamp and a module tag so
// log output can be traced back to its source without grepping stack traces.
// Never pass secrets (tokens, passwords, API keys) as log args.
function log(level, moduleName, args) {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${moduleName}]`;
  const method = level === 'debug' ? 'log' : level;
  console[method](line, ...args);
}

export function createLogger(moduleName) {
  return {
    debug: (...args) => { if (process.env.NODE_ENV !== 'production') log('debug', moduleName, args); },
    info: (...args) => log('info', moduleName, args),
    warn: (...args) => log('warn', moduleName, args),
    error: (...args) => log('error', moduleName, args),
  };
}

export default createLogger('app');
