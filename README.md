# Flocko Wars

World-map territory conquest prototype with dynamically expanding hex territories and a real-time multiplayer lobby.

## Frontend
The static client is in `index.html`. It is hosted at https://flocko-wars.onrender.com.

## Lobby server
- Node.js + Express + Socket.IO
- Public room discovery, invite codes, ready checks, host handoff and start validation
- Health endpoint: `/health`

## Local run
```bash
npm install
npm start
```
The client currently targets `https://flocko-wars-server.onrender.com`.

## Deploy
- Static site: publish directory `.`, build command `echo "Flocko Wars ready"`
- Web service: build command `npm install`, start command `npm start`, Node runtime.
