// The real database: MongoDB Atlas through the official Node.js driver.
//
// The client lives in module scope, so every request handled by the same function instance reuses
// one small connection pool instead of opening a new connection each time.
import { MongoClient } from 'mongodb';

let client;
let connecting;

/**
 * @param {string} uri    the connection string from MONGODB_URI
 * @param {string} dbName the database to use inside the cluster
 */
export function connect(uri, dbName) {
  if (!connecting) {
    client = new MongoClient(uri, {
      appName: 'trackmate',
      maxPoolSize: 10,
      minPoolSize: 0,
      // Close idle connections quickly so a paused function instance does not hold on to them.
      maxIdleTimeMS: 5000,
      serverSelectionTimeoutMS: 8000,
    });
    if (process.env.VERCEL) {
      // On Vercel, let the platform wait for idle connections to close before it suspends the instance.
      import('@vercel/functions')
        .then((vercel) => vercel.attachDatabasePool?.(client))
        .catch(() => undefined);
    }
    connecting = client.connect().then(
      () => client.db(dbName),
      (error) => {
        connecting = undefined;
        throw error;
      },
    );
  }
  return connecting;
}

export async function disconnect() {
  const open = client;
  client = undefined;
  connecting = undefined;
  await open?.close();
}
