# ChatApp (Realtime Chat)

This is a full-stack realtime chat app built with:

- **Client:** React + Vite
- **Server:** Node.js + Express + Socket.IO
- **Database:** PostgreSQL + Prisma
- **Presence (optional):** Redis (multi-instance support)

## App Logic

### Auth (HTTP)

The app uses JWT authentication with refresh tokens stored in an **httpOnly cookie**.

- `POST /auth/register` – create a user
- `POST /auth/login` – issue access + refresh tokens
- `POST /auth/refresh` – rotate refresh token and mint a new access token
- `POST /auth/logout` – revoke refresh token + clear cookie

### Contacts (Contact Finder)

The sidebar includes a **New Chat** button that opens a contact finder:

1. User enters an email query.
2. Client calls: `GET /users/search?email=...`
3. User clicks **Chat** for a result.
4. Client calls: `POST /conversations` with `type: "DIRECT"` and `targetUserId`

The server does a **find-or-create** for 1-on-1 conversations to avoid duplicates.

### Messaging (Persistence + Realtime)

Messaging is persisted in PostgreSQL and delivered in realtime via Socket.IO.

#### 1) Load persisted history (prevents message loss on refresh)

When the user selects a conversation, the client fetches message history over HTTP:

- `GET /conversations/:id/messages?limit=30`

This is what makes previous messages stay visible after a browser refresh.

#### 2) Realtime updates (Socket.IO)

The client joins the conversation room and listens for events:

- `message:new` – new incoming message (updates local state)
- `message:delivered` – server confirms delivery
- `message:read` – server confirms read receipts
- `conversation:typing` – typing indicators
- `conversation:presence` / `user:online` / `user:offline` – presence state

Optimistic sending is used:

- Client adds a local `SENDING` message immediately
- Server acks the message via the Socket.IO event callback
- Client replaces optimistic state with the persisted server message (or marks it `FAILED`)

#### 3) Pagination

Older messages can be loaded by scrolling near the top:

- Uses cursor pagination on `createdAt` with `before=<ISO timestamp>`

### Data Model (Prisma)

Core entities in `server/prisma/schema.prisma`:

- `User`
- `Conversation` (DIRECT and GROUP)
- `ConversationMember` (with `leftAt` for soft leave)
- `Message` (with `status`, `isDeleted`, and optional `attachments`)
- `Attachment`
- `MessageReadReceipt`

## Setup (Local Development)

### 1) Start PostgreSQL (Docker)

1. Ensure **Docker Desktop** is running.
2. Run Postgres:

```bash
docker run -d --name chatapp-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=chatapp \
  -p 5432:5432 \
  postgres:16-alpine
```

> If you already have a running container named `chatapp-postgres`, you can skip this.

### 2) Configure the server environment

Edit `server/.env` and ensure:

- `DATABASE_URL=postgresql://postgres:password@localhost:5432/chatapp`
- `JWT_ACCESS_SECRET=...`
- `JWT_REFRESH_SECRET=...`
- `CLIENT_ORIGIN=http://localhost:5173`
- Optional: `REDIS_URL=redis://localhost:6379`

### 3) Create/update the database schema

From the repo root:

```bash
cd server
npx prisma db push --schema ./prisma/schema.prisma
```

(Or run `npm run db:generate` after `npm install` in `server/`; the schema path is set in `server/package.json` under `"prisma": { "schema": "./prisma/schema.prisma" }`.)

### 4) Install and run the servers

Run the backend:

```bash
cd server
npm install
npm run dev
```

Run the frontend (in a separate terminal):

```bash
cd client
npm install
npm run dev
```

Then open the app at:

- `http://localhost:5173`

### Optional: Redis

If you set `REDIS_URL`, the server enables Redis-backed presence + typing and can support multi-instance Socket.IO.

### Railway (or similar PaaS)

Set the service **root directory** to `server` so `npm install` runs there. The `postinstall` script runs `prisma generate` using `server/prisma/schema.prisma`; the `prisma` CLI is a **dependency** (not only a devDependency) so it is available when `NODE_ENV=production`.

In the platform **Variables** UI, define at least:

- `DATABASE_URL` – PostgreSQL connection string (e.g. Neon)
- `JWT_ACCESS_SECRET` – long random secret for access tokens
- `JWT_REFRESH_SECRET` – long random secret for refresh tokens
- `CLIENT_ORIGIN` – your deployed frontend origin (e.g. `https://your-app.vercel.app`)

If variables are missing, the app will fail at startup (there is no `.env` file injected in production).

## Folder Structure (High Level)

### Server

- `server/prisma/schema.prisma` – Prisma schema (client generated on `npm install` / `postinstall`)
- `server/app.js` – Express app wiring (CORS + routes)
- `server/routes/*` – HTTP routes
- `server/controllers/*` – business logic / Prisma calls
- `server/middleware/*` – JWT verification (HTTP + Socket.IO auth handshake)
- `server/sockets/*` – Socket.IO handlers (connection, conversation, message)
- `server/lib/*` – Prisma singleton, Redis client, presence/typing stores

### Client

- `client/src/App.jsx` – root app wiring (auth gate + layout)
- `client/src/hooks/useAuth.js` – refresh token flow + access token state
- `client/src/hooks/useConversations.js` – sidebar conversation list + presence wiring
- `client/src/hooks/useChat.js` – message loading + realtime socket messaging
- `client/src/components/*` – UI components (Sidebar, MessageList, MessageInput, ContactFinder)

## License Template

Choose a license and replace the placeholders below if you want to publish this project.

### MIT License (template)

```text
MIT License

Copyright (c) <YEAR> <COPYRIGHT HOLDER>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

