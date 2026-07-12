# Smart QR Inventory

A Progressive Web App (PWA) for QR-code-based inventory management. Scan or
create QR-labeled bins, add items with photos, search across your inventory,
and export/restore everything (including images) for backup.

## Stack

- **Client**: React 19 + Vite + Tailwind CSS v4, served as a single-page app.
- **Server**: Node.js + Express + SQLite (via `sqlite`/`sqlite3`), with image
  processing through `sharp` and backup archives via `archiver`/`unzipper`.
- **Packaging**: multi-stage Docker image published to GitHub Container Registry.

## Repository layout

```
client/   # Vite/React front-end (PWA)
server/   # Express + SQLite back-end API
.github/  # CI (tests + build) and release (GHCR) workflows
```

## Prerequisites

- Node.js 22+ (the Docker image uses `node:22-slim`)
- npm 10+

## Development

Start the back-end (defaults to port `5005`):

```bash
cd server
npm install
npm run dev      # nodemon; or: npm start
```

Start the front-end (Vite dev server on port 5173):

```bash
cd client
npm install
npm run dev      # vite
```

The client talks to the API at `http://localhost:5005` (configured in the app).

### Environment

- `PORT` — server listen port (default `5005`)
- `GOOGLE_API_KEY` — optional; enables the Gemini image-analysis feature
  (it can also be set from the app's Settings screen)

## Testing

```bash
cd client && npm test    # vitest smoke tests
cd server && npm test    # node:test smoke tests
```

## Lint / build

```bash
cd client && npm run lint && npm run build
```

## Docker

Build the image locally (builds the client, then runs the server, which also
serves the built client from `client/dist`):

```bash
docker build -t smart-qr .
docker run -p 5005:5005 -v "$(pwd)/server/uploads:/app/uploads" smart-qr
```

Open `http://localhost:5005`.

### Container image (GHCR)

On each tagged release the image is published to `ghcr.io/nag-sh/smart-qr`:

```bash
docker pull ghcr.io/nag-sh/smart-qr:latest
```

Images are private, matching the private repository.

## Data & persistence

- `server/inventory.db*` — SQLite database (runtime; not committed)
- `server/uploads/` — uploaded item images (runtime; not committed)

Mount a volume at `/app/uploads` and persist `inventory.db` for durable data.

## Contributing

This repository enforces **branch protection on `main`**: all changes must go
through a pull request — direct pushes to `main` are blocked. Fork/branch,
open a PR, and let CI (client lint + tests + build, server tests, and a Docker
build check) validate it before merge.
