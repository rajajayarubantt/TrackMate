// The Vercel Function behind every /api/* address (vercel.json sends them all here).
// The work happens in server/app.js, which the local dev server uses too.
import { handle } from '../server/app.js';

export default {
  fetch(request) {
    return handle(request);
  },
};
