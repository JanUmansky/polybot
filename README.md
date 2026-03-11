# Polybot

Polymarket trading bot platform with a Next.js dashboard, a WebSocket relay server, and an automated trading bot — all backed by MongoDB.

## Prerequisites

### Git

```bash
git clone <repo-url>
cd polybot
```

### Node.js

Install Node.js **v20+** from [nodejs.org](https://nodejs.org/) or via a version manager:

```bash
# macOS (Homebrew)
brew install node
```

### MongoDB

1. Install MongoDB Community Edition:

```bash
# macOS (Homebrew)
brew tap mongodb/brew
brew install mongodb-community
```

2. Start the MongoDB service:

```bash
brew services start mongodb-community
```

3. Verify it's running:

```bash
mongosh --eval "db.runCommand({ ping: 1 })"
```

4. The default connection string is `mongodb://localhost:27017/polybot`. The `polybot` database and its collections are created automatically on first run — no manual setup required.

## Environment Variables

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `PRIVATE_KEY` | Polymarket wallet private key |
| `POLY_FUNDER` | Polymarket funder address |
| `BUILDER_API_KEY` | Builder relayer API key |
| `BUILDER_API_SECRET` | Builder relayer API secret |
| `BUILDER_API_PASSPHRASE` | Builder relayer API passphrase |
| `POLYGON_RPC` | Polygon RPC endpoint (default: `https://polygon.drpc.org`) |
| `MONGODB_URI` | MongoDB connection string (default: `mongodb://localhost:27017/polybot`) |

## Install Dependencies

From the project root, a single install covers all workspaces (`common`, `bot`, `client`, `ws-server`):

```bash
npm install
```

## Running the Platform

### WebSocket Server

Pub/sub relay that fans out real-time events between the bot and the dashboard.

```bash
npm run ws-server
```

Runs on port **3004** by default.

### Bot

The automated Polymarket trading bot.

```bash
npm run bot
```

### Client (Dashboard)

Next.js web UI for managing bots, strategies, and viewing stats.

```bash
npm run client
```

Runs on [http://localhost:3003](http://localhost:3003).

To create a production build:

```bash
npm run client:build
```

## Project Structure

```
polybot/
├── bot/          # Trading bot
├── client/       # Next.js dashboard
├── common/       # Shared Mongoose schemas & models
├── ws-server/    # WebSocket pub/sub relay
└── scripts/      # Utility scripts
```
