#!/usr/bin/env node
// Sets a new password for an account when the old one is forgotten (TrackMate does not send email).
//
//   npm run reset-password -- you@example.com
//
// It uses MONGODB_URI from .env.local, asks for the new password, and signs that account out everywhere.
import { createInterface } from 'node:readline';
import { loadEnv } from './env.mjs';

loadEnv();
const email = (process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.error('\n  Say which account:  npm run reset-password -- you@example.com\n');
  process.exit(1);
}

function askHidden(prompt) {
  process.stdout.write(prompt);
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      const lines = createInterface({ input: process.stdin });
      lines.once('line', (line) => {
        lines.close();
        resolve(line);
      });
      lines.once('close', () => resolve(''));
    });
  }
  return new Promise((resolve) => {
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          process.stdout.write('\n');
          process.exit(1);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}

const { closeDatabase, database, databaseName } = await import('../server/db.js');
const { hashPassword } = await import('../server/auth.js');
const { describeDatabaseError } = await import('../server/errors.js');

try {
  const { db, kind } = await database();
  const users = db.collection('users');
  const user = await users.findOne({ email });
  if (!user) {
    console.error(`\n  No account uses ${email} in ${kind === 'mongodb' ? `database "${databaseName()}"` : 'the local stand-in database'}.\n`);
    process.exitCode = 1;
  } else {
    const password = await askHidden(`  New password for ${user.name} <${email}>: `);
    if (password.length < 8 || password.length > 200) {
      console.error('\n  Use a password with 8 to 200 characters. Nothing was changed.\n');
      process.exitCode = 1;
    } else {
      await users.updateOne({ _id: user._id }, { $set: { pass: await hashPassword(password), fails: 0, lockUntil: 0 }, $inc: { tokenVersion: 1 } });
      console.log('\n  Password changed. That account has been signed out on every device.\n');
    }
  }
} catch (error) {
  console.error(`\n  ${describeDatabaseError(error) || error.message}\n`);
  process.exitCode = 1;
} finally {
  await closeDatabase().catch(() => undefined);
}
