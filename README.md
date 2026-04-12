# Sari-Sari Store Management System

A Bootstrap-based Sari-Sari Store Management System built with Express, EJS, and SQLite.

## Features

- Dashboard with sales and inventory overview
- Inventory management
- Sales recording
- Reports and best-selling products view
- Settings page for store profile, notifications, appearance, export, backup, and reset
- Seeded demo data for quick local testing

## Requirements

- Node.js 22 or newer

`node:sqlite` is used by this project, so an older Node.js version will not run the app correctly.

## Installation

1. Open a terminal in the project folder.
2. Install dependencies:

```bash
npm install
```

## How To Run

Start the app with:

```bash
npm start
```

By default, the server runs at:

```text
http://localhost:3000
```

Open that URL in your browser, then sign in with the default demo account:

- Username: `admin`
- Password: `admin123`

## Environment Variables

These are optional:

- `PORT` - changes the server port. Default: `3000`
- `SESSION_SECRET` - custom session secret for local or production-like runs
- `NODE_ENV` - when set to `production`, secure session cookies are enabled

Example:

```bash
$env:PORT=4000
$env:SESSION_SECRET="your-secret"
npm start
```

## Database And Seed Data

- The SQLite database file is created automatically at `data/store.db`
- On first run, the app seeds:
  - a default admin user
  - store settings
  - sample inventory items
  - sample sales history

If the database already exists, the app reuses it.

## Quick Test

Run the smoke test with:

```bash
npm run test:smoke
```

This starts the server, checks the login flow, and verifies the main pages and CSV export routes.

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
- The Settings page includes export and backup actions.
- Resetting data from Settings restores the seeded demo content.
