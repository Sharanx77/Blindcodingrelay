# Signal/Noise — Blind Coding Challenge

A React + TypeScript/Vite participant and organiser app, with an Express/Socket.IO game server and a persistent SQLite database powered by sql.js (WebAssembly; no native SQLite addon required).

## Run locally

Requirements: Node.js 22 and npm 10+.

```powershell
npm install
Copy-Item .env.example .env
# Set ADMIN_PASSWORD and ADMIN_TOKEN_SECRET in .env
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The API and Socket.IO server listens on port `3001`; Vite proxies `/api` and `/socket.io` to it. In development, the organiser password defaults to `dev-only-change-this` if `ADMIN_PASSWORD` is unset; configure a private value before sharing the app.

For a production build:

```powershell
npm run build
npm start
```

The Express server serves `client/dist` alongside the API. Set `NODE_ENV=production`, `ADMIN_PASSWORD` (at least 12 characters), and a random `ADMIN_TOKEN_SECRET` (at least 32 characters) before deployment. `PORT`, `DATABASE_PATH`, and `CLIENT_ORIGIN` are configurable in `.env`. For a same-origin production deployment, leave `CLIENT_ORIGIN` unset.

## Deploy to Render

The included `render.yaml` is a Render Blueprint for a single Node web service with a 1 GB persistent disk. Push this project folder to a GitHub repository, then in Render choose **New → Blueprint** and select that repository. Review and apply the Blueprint. Render will prompt you for `ADMIN_PASSWORD` and generate `ADMIN_TOKEN_SECRET`; choose a private password of at least 12 characters. The database is stored at `/var/data/challenge.sqlite` on the persistent disk.

Open the deployed `onrender.com` URL and use the configured password under **Organiser Access**. The client, API, and Socket.IO all use the same origin; no CORS URL or third-party API keys are needed. Keep this deployment at one service instance: the SQLite database and in-memory live rooms are designed for a single instance. Use a paid Render instance with persistent-disk support. Do not remove the disk or change `DATABASE_PATH` if you want to retain saved events.


## Event rules

| Round | Name | Time | Maximum |
|---|---|---:|---:|
| 1 | Type Before Time Runs Out | 30 seconds | 10 points |
| 2 | Blind Code Master | 45 seconds | 20 points |
| 3 | Decode, Type & Win | 60 seconds | 30 points |

The score is `round maximum × accuracy`; speed adds no points. Accuracy is calculated from Levenshtein edit distance against the exact reference, including spaces, line breaks, punctuation, and symbols. The server caps challenge and submitted text at 10,000 characters.

The organiser signs in with the configured password, creates a room, edits each round's reference and duration, shares the generated six-character code, and controls each round from the live console. Round durations can be set from 5 to 3,600 seconds. Participants register with a display name and USN; USNs are unique within each room. Results and challenge text are persisted in `server/data/challenge.sqlite`.

Completed events appear in the organiser's event history. Organisers can inspect participants and round-by-round results, rename a completed event, or permanently delete it with its associated participants and scores. Event names can only be changed after completion; deleting a non-completed event is blocked.

## Notes

- The game clock and evaluation run on the server. Participants' draft text is sent to the server while a round is active; only aggregate participant data and finalized round scores are broadcast.
- The participant editor masks visible characters and prevents normal paste, copy, cut, drag/drop, and context-menu interactions. Browser-side controls are user-interface deterrents, not a substitute for supervised event rules or a locked-down kiosk.
- The development seed challenges are inserted automatically on first startup. `npm run seed` restores/reseeds the three sample templates.
- On restart, completed scores and room definitions are restored. An interrupted unfinished round returns to its lobby state so the organiser can restart that round; draft text is intentionally not persisted.
- Existing databases are migrated at startup to add per-round timing and participant USN storage. Participants who only exist in older score rows receive a generated `LEGACY-…` USN in the event history.
