# TrackMate

Links, tasks, notes, tags and a calendar in one app. React + TypeScript, styled after Apple's
Liquid Glass design. Your data is stored in **MongoDB Atlas**, reached through **one Vercel
Function**, and the whole project deploys to Vercel as it is.

## Deploy to Vercel

You need a MongoDB Atlas account, a Vercel account and this folder in a Git repository
(GitHub, GitLab or Bitbucket).

### 1. Create the database (MongoDB Atlas)

1. In [Atlas](https://cloud.mongodb.com), create a cluster. The free tier is enough.
2. **Database Access** → add a database user with a password and the *Read and write to any
   database* role.
3. **Network Access** → add `0.0.0.0/0` (allow access from anywhere). Vercel's functions do not
   have fixed IP addresses, so Atlas has to accept connections from any address; the username
   and password are what protect the database.
4. **Connect → Drivers** → copy the connection string. It looks like
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`.
   Put the user's real password in place of `<db_password>`.

You do not need to create a database or collections: TrackMate creates a database called
`trackmate` and its collections the first time it runs.

> Shortcut: adding the **MongoDB Atlas** integration from the Vercel Marketplace to your project
> creates the cluster, opens network access and sets `MONGODB_URI` for you. You then only add
> `SESSION_SECRET` in step 3.

### 2. Import the project into Vercel

Push this folder to a Git repository, then in Vercel choose **Add New → Project** and import it.
Leave every build setting as it is: `vercel.json` already tells Vercel how to build
(`npm run build`), what to serve (`dist/`) and where the API lives (`api/index.js`).

(Or, with the Vercel CLI: run `npx vercel` in this folder, then `npx vercel --prod`.)

### 3. Add the environment variables

In the Vercel project: **Settings → Environment Variables**.

| Name | Required | Value |
| --- | --- | --- |
| `MONGODB_URI` | yes | The Atlas connection string from step 1 |
| `SESSION_SECRET` | yes | Any long random text. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `MONGODB_DB` | no | Database name inside the cluster. Defaults to `trackmate` |
| `SIGNUP` | no | Set to `closed` to stop new accounts being created (see [Accounts](#accounts)) |

Then **redeploy** (Deployments → the latest one → Redeploy): environment variables only reach
deployments made after they were added.

`MONGODB_URI` contains your database password and `SESSION_SECRET` signs every session. Keep
both only in Vercel's settings (and in `.env.local` on your own computer). Never commit them.

### 4. Check it

Open `https://YOUR-APP.vercel.app/api/health`. A working deployment answers:

```json
{ "ok": true, "database": "MongoDB, database \"trackmate\"", "signup": "open" }
```

If something is missing, the same address says what: `MONGODB_URI is not set…`,
`SESSION_SECRET is not set…`, or that Atlas could not be reached (usually step 1.3) or rejected
the username or password. Then open the app itself and create your account.

## Run it on your computer

You need Node.js 22.

```bash
npm install
npm run dev        # http://localhost:5173, rebuilds when you edit a file
```

`npm run dev` serves the app **and** the API on one address, using the same server code that
runs on Vercel. With no setup it keeps data in a small stand-in database saved to
`.data/dev-db.json`, so you can try everything without Atlas. To use your real database
locally, copy `.env.example` to `.env.local` and fill in `MONGODB_URI` and `SESSION_SECRET`.

| Command | What it does |
| --- | --- |
| `npm run dev` | App + API with live reload. Prints an address for other devices on your network |
| `npm run build` | Production build into `dist/` (this is what Vercel runs) |
| `npm run preview` | Builds, then serves `dist/` and the API on port 5173 |
| `npm test` | Runs the test suite against the stand-in database (no Atlas needed) |
| `npm run check:db` | Checks **your** Atlas database with the same code Vercel runs: creates two throw-away accounts, saves and reads one of everything, then deletes them again. Uses `.env.local` |
| `npm run reset-password -- you@example.com` | Sets a new password for an account. Uses `.env.local` |
| `npm run typecheck` | Type-checks the app with TypeScript |

Set `PORT` to change the port.

## What is inside

| App | What it does |
| --- | --- |
| **Today** | What is next, today's schedule, what is due, a tasks ring and focus minutes, unread links, notes and tags |
| **Links** | Paste a link: its title, description and banner are looked up for you. Add your own description and tags. Unread / pinned filters, card or list view, duplicate detection, tag suggestions |
| **Tasks** | A grouped list (overdue, today, upcoming) and a board. Drag cards between stages with a mouse or by pressing and holding on a touch screen. Add, rename, recolour, reorder and limit stages. Due dates, reminders, priority, checklists, tags |
| **Notes** | A block editor: headings, to-dos, lists, quotes, callouts, code and dividers. Type `/` for the block menu, or Markdown shortcuts (`# `, `- `, `[] `, `> `, `1. `). Saves automatically as you type |
| **Calendar** | Day, week, month and agenda views. Tap a slot (or drag across one with a mouse) to add a meeting, event, reminder or task. Repeats, alerts, meeting links with a Join button |
| **Tags** | Create tags with an icon and a colour. Open a tag to see every link, task, note and event that uses it |

Also included:

- **Quick capture and search** (the search button, `⌘K` / `Ctrl+K`, or `/`). Type the way you would
  say it: `Call the bank tomorrow 3pm #personal !high`, `meeting Design review fri 10am for 45m`,
  `note Ideas for the offsite`, `remind me to stretch in 20 minutes`, or paste a link.
- **Reminders** as in-app banners, an optional chime, and system notifications once you allow them.
- **Focus timer** started from any task; minutes are logged against the task.
- **Light and dark themes**, a tint per app (or one tint everywhere), and a glass slider from clear to tinted.
- **Undo** after deleting a link, task, note or event.
- **Installable**: add it to your home screen. It opens and works offline.

Every control is drawn by the app: menus, selects, date and time pickers, colour picker, icon
picker, switches, alerts. Nothing uses the browser's built-in versions.

## Where your data lives

Everything is in your MongoDB database, one collection per kind of item: `users`, `tags`,
`links`, `stages`, `tasks`, `notes`, `events`, `reminders` and `focus`. Every document carries
the id of the account that owns it, and an account can only ever read or change its own.

- **It syncs.** Sign in on a phone and a laptop and both show the same data. A device picks up
  changes made elsewhere when you return to it, about once a minute while it is open, and
  straight away between tabs of the same browser.
- **It works offline.** Each device keeps a copy (in the browser's IndexedDB), so TrackMate opens
  instantly and you can keep working without a connection. Changes made offline are sent when
  you reconnect. Settings → Data shows whether everything is synced.
- **If two devices change the same item**, the one saved last wins. Changes to different items
  never overwrite each other.
- **Backups.** Settings → Data → *Download a backup* saves everything in your account as one
  `.json` file; *Restore a backup* replaces the account's contents with such a file.
- **Deleting.** Settings → Account → *Delete account* removes the account and all of its data
  from the database.

This version does not read the SQLite data of the earlier, browser-only TrackMate. That data is
left untouched in the browser where it was created.

## Accounts

Accounts are created on the server. Passwords are stored as salted scrypt hashes, never as
text. Signing in sets an `HttpOnly` cookie (`Secure` on https, `SameSite=Lax`) that lasts 30
days and renews while you keep using the app. Changing your password signs out every other
device. Eight wrong passwords in a row lock sign-in for that account for five minutes.

- **Anyone who can open your deployment can create an account** (each account only sees its own
  data). To keep it to yourself, create your account, then set `SIGNUP=closed` in Vercel and
  redeploy. The sign-in screen then no longer offers "Create account".
- **Forgotten password.** TrackMate does not send email. Set a new one from your computer with
  `npm run reset-password -- you@example.com` (it uses `MONGODB_URI` from `.env.local`).

## Link previews

A web page is not allowed to read another site's HTML, so the title, description and banner of a
saved link are looked up for you. **Settings → Link previews** chooses how:

- **Automatic** (default): TrackMate's own function (`/api/preview`) fetches the page. Some sites
  refuse requests from servers; for those it then asks [Microlink](https://microlink.io), a
  preview service, and sends it the link's address.
- **TrackMate only**: nothing is sent to a third party.
- **Microlink only**
- **Off**: links are saved with details taken from the address.

If no lookup succeeds, the link is still saved and gets a generated banner. The preview function
only fetches public web addresses, never private or internal ones.

## Reminders

Reminders are checked by the page itself, so they fire while TrackMate is open in a tab or
installed on your home screen. It cannot alert you while it is fully closed. Ones that came due
while it was closed are listed the next time you open it. A reminder that has gone off on one
device is not repeated on another once they have synced.

## Project layout

```
api/index.js          the Vercel Function: every /api/* request arrives here
server/               what the function does (also used by the local dev server)
  app.js              routes: signup, signin, signout, me, data, sync, password,
                      delete-account, preview, health
  auth.js             password hashing and the signed session cookie
  validate.js         checks every document before it is stored
  db.js, mongo.js     the MongoDB connection (one small pool per function instance)
  memory-db.js        stand-in database for local development and tests
  preview.js          fetches a page and reads its title, description and banner
vercel.json           build command, output folder, /api rewrite, caching headers
.env.example          the environment variables, with explanations
index.html            page shell
public/               icons, web app manifest, service worker
scripts/              build / dev server (esbuild), check-db, reset-password
src/
  main.tsx, App.tsx   start-up
  db/                 in-memory data + sync with the API (store.ts), typed queries (repo.ts)
  lib/                API client, session, dates, quick-capture parser, link previews, notifications
  ui/                 design system: buttons, sheets, menus, pickers
  shell/              app frame, sign-in, settings, quick capture, reminders, focus timer
  modules/            Today, Links, Tasks, Notes, Calendar, Tags
  styles/             design tokens and component styles
tests/                API, link preview, sync and deployment tests (npm test)
```

How saving works: a change is applied on screen at once, queued, and sent to `POST /api/sync` a
moment later as whole documents (several changes travel together). The server checks each
document field by field, stores it, and raises the account's revision number; other devices
compare that number to know when to fetch again.

To add a field to something that is stored, add it in three places: the type in
`src/db/types.ts`, the document builder in `src/db/repo.ts`, and the shape in
`server/validate.js` (the server refuses fields it does not know).

## Browser support

Current Chrome, Edge, Safari (iOS 16.4 and later) and Firefox. On Apple devices the interface uses
San Francisco, the system font; elsewhere it falls back to the system UI font.
