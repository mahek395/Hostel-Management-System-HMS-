# Hostel Management

This is the Hostel Management project (warden & student interfaces). It includes a Node.js/Express backend and a static frontend (plus a React frontend under `hostel-frontend/`).

## What’s in this repo
- `server.js` - Node/Express server and API endpoints.
- `public/` - static HTML pages used by the app (warden pages, student pages, etc.).
- `hostel-frontend/` - React frontend (Vite) for an alternate UI.
- `package.json` - root npm scripts & server dependencies.

## Prerequisites
- Node.js (14+ recommended)
- npm (or yarn)
- MySQL server (or compatible) and credentials

## Quick local setup
1. Install dependencies (root and frontend):

```powershell
npm install
cd hostel-frontend
npm install
cd ..
```

2. Create an environment file for DB credentials and any secrets. Do NOT commit this file.

Create a `.env` file in the project root with values like:

```text
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your-db-password
DB_NAME=hostel_db
PORT=3000
```

3. Start the server (from project root):

```powershell
# run server
node server.js
# or if you use npm script
npm start
```

4. Open the static pages in the browser (server serves them):

http://localhost:3000/

For the React frontend (if used):

```powershell
cd hostel-frontend
npm run dev
# then open the Vite URL printed in console
```

## Database
- The server expects a MySQL database. Ensure the DB and required tables are created. Check `server.js` for SQL table names and sample queries.
- If you need, I can help generate SQL `CREATE TABLE` scripts based on `server.js` queries.