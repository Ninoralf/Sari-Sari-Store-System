# Sari-Sari Store Management System

This project is a Bootstrap-based Sari-Sari Store Management System built with Express, EJS, and SQLite for a System Architecture subject from the University of Cebu.

## Members
- Ninoralf Dela Cruz
- John Anthony Rebusora
- Marju Faller

## Features

- Dashboard with sales and inventory overview
- Inventory management
- Sales recording
- eLoad and GCash request management
- Logs, exports, backup, and safe data reset tools
- Settings page for store profile, notifications, appearance, export, backup, and reset
- Seeded demo data for quick local testing

## Requirements

- Node.js 22 or newer

`node:sqlite` is used by this project, so an older Node.js version will not run the app correctly.

## Installation

1. Open a terminal in the project folder.
2. Install dependencies, including the development tool `nodemon`:

```bash
npm install
```

## Available Scripts

The project currently includes these scripts:

```bash
npm start
npm run dev
npm run test:smoke
```

- `npm start` starts the app normally with Node.js
- `npm run dev` starts the app with `nodemon` and automatically restarts when you save changes
- `npm run test:smoke` runs the smoke test script

## How To Run

For normal use, start the app with:

```bash
npm start
```

For development with auto-reload, use:

```bash
npm run dev
```

`nodemon` watches `src/server.js` and restarts the server when backend files change.

By default, both commands run the app at:

```text
http://localhost:3000
```

Open that URL in your browser, then sign in with the default demo account:

- Username: `admin`
- Password: set `ADMIN_PASSWORD` in `.env` or your environment to control the seeded admin password

If `ADMIN_PASSWORD` is not provided on a fresh database, the app falls back to `admin123` and requires an immediate password change after the first login.

## Environment Variables

These are supported:

- `PORT` - changes the server port. Default: `3000`
- `ADMIN_PASSWORD` - seeded admin password for a fresh database
- `SESSION_SECRET` - session signing secret. Required when `NODE_ENV=production`
- `NODE_ENV` - when set to `production`, secure session cookies are enabled and `SESSION_SECRET` must be configured
- `STORE_DB_PATH` - optional alternate SQLite path, useful for isolated tests or custom deployments

Example:

```bash
$env:PORT=4000
$env:ADMIN_PASSWORD="strong-admin-password"
$env:SESSION_SECRET="your-secret"
npm run dev
```

## Database And Seed Data

- The SQLite database file is created automatically at `data/store.db`
- On first run, the app seeds:
  - a default admin user
  - store settings
  - sample inventory items
  - sample sales history

If the database already exists, the app reuses it.

Existing deployments keep their current database and accounts. Startup migrations are designed to be idempotent and backward compatible.

## Quick Test

Run the smoke test with:

```bash
npm run test:smoke
```

This starts the server, checks the login flow, and verifies the main pages and CSV export routes.
The smoke test uses its own temporary SQLite database so it does not modify your existing local data.

## Updates And Versions

This project keeps release history and popup update notes in two separate files:

- `CHANGELOG.md` stores the fuller project release history.
- `public/version.json` powers the in-app "What's New" popup shown to users.

When publishing a user-facing update:

1. Update `CHANGELOG.md` with the release summary.
2. Update `public/version.json` with the new version number and the list of changes you want shown in the popup.

Important behavior:

- If you change `public/version.json` and increase `version`, the popup appears again for users.
- If you only change the `changes` list but keep the same `version`, users who already saw that version will not get the popup again.
- If you make code changes but do not update `public/version.json`, no new "What's New" popup will appear.

Example `public/version.json`:

```json
{
  "version": "1.0.1",
  "changes": [
    "Fixed inventory stock display",
    "Improved dashboard loading speed",
    "Updated eLoad promo management"
  ]
}
```

## Project Structure

```text
src/        Express server and database logic
views/      EJS templates
public/     Static assets
scripts/    Utility and test scripts
data/       SQLite database file
```

## Notes

- The app automatically creates the `data` folder if it does not exist.
- `nodemon` is included as a dev dependency for local development.
- The Settings page includes export and backup actions.
- Resetting data from Settings clears operational records while keeping accounts, settings, and configured reference data.
- The old Reports and Best Selling pages are kept as compatibility redirects to the Dashboard.
