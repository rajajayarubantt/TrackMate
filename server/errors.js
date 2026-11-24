/** An error whose message is safe to show to the person using the app. */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   * @param {Record<string, unknown>} [extra] extra fields for the JSON body
   */
  constructor(status, message, extra) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.extra = extra;
  }
}

/** The deployment is missing a setting (an environment variable). */
export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Turn a database driver failure into something the person deploying the app can act on. */
export function describeDatabaseError(error) {
  const name = String(error?.name || '');
  const message = String(error?.message || '');
  if (error?.code === 8000 || error?.code === 18 || /auth/i.test(message)) {
    return 'MongoDB rejected the username or password in MONGODB_URI. Check the database user in Atlas (Database Access) and the connection string.';
  }
  if (/ServerSelection|Network|Timeout|ENOTFOUND|ECONNREFUSED/i.test(`${name} ${message}`)) {
    return 'Could not reach MongoDB Atlas. In Atlas, open Network Access and allow connections from anywhere (0.0.0.0/0), and check that MONGODB_URI is correct.';
  }
  if (/Invalid scheme|connection string|URI/i.test(message)) {
    return 'MONGODB_URI is not a valid MongoDB connection string. It should start with mongodb+srv:// or mongodb://.';
  }
  return '';
}

export const isDatabaseError = (error) => /^Mongo/.test(String(error?.name || ''));
