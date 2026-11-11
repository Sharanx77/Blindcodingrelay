import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { isValidAdminToken, issueAdminToken } from "./auth.js";
import { ROUND_CONFIG } from "./challenges.js";
import {
  getTemplateChallenges,
  initializeDatabase,
  roomDetails,
  roomScoreRows,
  roomSummaries,
  saveRoom,
  saveRoomChallenges
} from "./database.js";
import { generateRoomCode, GameManager } from "./game.js";

const port = Number(process.env.PORT ?? 3001);
const adminPassword = process.env.ADMIN_PASSWORD ?? "dev-only-change-this";
const tokenSecret = process.env.ADMIN_TOKEN_SECRET ?? "dev-only-token-secret-change-this";
const isProduction = process.env.NODE_ENV === "production";
const allowedOrigin = process.env.CLIENT_ORIGIN ?? (isProduction ? undefined : "http://localhost:5173");

if (isProduction && (
  adminPassword.trim().length < 12 ||
  adminPassword === "dev-only-change-this" ||
  tokenSecret.length < 32 ||
  tokenSecret === "dev-only-token-secret-change-this"
)) {
  throw new Error("Production requires ADMIN_PASSWORD (12+ characters) and ADMIN_TOKEN_SECRET (32+ characters).");
}
if (allowedOrigin) {
  const parsedOrigin = new URL(allowedOrigin);
  if (parsedOrigin.origin !== allowedOrigin || (isProduction && parsedOrigin.protocol !== "https:")) {
    throw new Error("CLIENT_ORIGIN must be an origin without a path and use HTTPS in production.");
  }
}
if (!isProduction && adminPassword === "dev-only-change-this") {
  console.warn("Using the development organiser password. Set ADMIN_PASSWORD in .env before deployment.");
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: allowedOrigin ?? false, methods: ["GET", "POST"] },
  maxHttpBufferSize: 1e6
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  }
}));
app.use(cors({ origin: allowedOrigin ?? false, methods: ["GET", "POST"] }));
app.use(express.json({ limit: "100kb" }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again in 15 minutes." }
});

function requireAdmin(request: Request, response: Response, next: NextFunction): void {
  const authorization = request.header("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!isValidAdminToken(token, tokenSecret)) {
    response.status(401).json({ error: "Organiser sign-in required." });
    return;
  }
  next();
}

function getRoomCode(request: Request): string {
  const parameter = request.params.code;
  return (Array.isArray(parameter) ? parameter[0] : parameter ?? "").toUpperCase();
}

const challengeSchema = z.object({
  round: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  referenceText: z.string().min(1).max(10_000),
  duration: z.number().int().min(5).max(3600).optional()
});
const createRoomSchema = z.object({
  name: z.string().trim().min(2).max(60),
  challenges: z.array(challengeSchema).length(3).refine(
    (challenges) => new Set(challenges.map(({ round }) => round)).size === 3,
    "Include one challenge for each round."
  )
});

await initializeDatabase();
const game = new GameManager(io);
for (const room of roomSummaries()) {
  game.restoreRoom(room.code, room.name, room.status, room.round);
}

io.use((socket: Socket, next) => {
  const requestOrigin = socket.handshake.headers.origin;
  const firstHeader = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value)?.split(",")[0]?.trim();
  const forwardedHost = firstHeader(socket.handshake.headers["x-forwarded-host"]);
  const forwardedProtocol = firstHeader(socket.handshake.headers["x-forwarded-proto"]);
  const requestHost = forwardedHost ?? firstHeader(socket.handshake.headers.host);
  const expectedOrigin = allowedOrigin ?? (
    requestHost
      ? `${forwardedProtocol ?? (isProduction ? "https" : "http")}://${requestHost}`
      : undefined
  );
  if (requestOrigin && expectedOrigin && requestOrigin !== expectedOrigin) {
    next(new Error("Origin is not allowed."));
    return;
  }

  if (socket.handshake.auth?.role !== "admin") {
    socket.data.role = "participant";
    next();
    return;
  }
  if (!isValidAdminToken(socket.handshake.auth?.token, tokenSecret)) {
    next(new Error("Organiser sign-in expired."));
    return;
  }
  socket.data.role = "admin";
  next();
});

io.on("connection", (socket) => {
  socket.on("join-participant", (payload: unknown) => {
    const parsed = z.object({
      code: z.string().regex(/^[A-Z0-9]{6}$/),
      name: z.string().trim().min(1).max(40),
      usn: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9._/-]+$/).transform((value) => value.toUpperCase()),
      participantId: z.string().uuid().optional()
    }).safeParse(payload);
    if (!parsed.success) {
      socket.emit("action-error", { message: "Enter a valid room code, display name, and USN." });
      return;
    }
    game.joinParticipant(
      socket,
      parsed.data.code,
      parsed.data.name,
      parsed.data.usn,
      parsed.data.participantId
    );
  });

  socket.on("join-admin", (payload: unknown) => {
    const parsed = z.object({ code: z.string().regex(/^[A-Z0-9]{6}$/) }).safeParse(payload);
    if (!parsed.success) {
      socket.emit("action-error", { message: "Invalid room code." });
      return;
    }
    game.joinAdmin(socket, parsed.data.code);
  });

  socket.on("participant-draft", (payload: unknown) => {
    const parsed = z.object({ text: z.string().max(10_000) }).safeParse(payload);
    if (parsed.success) game.updateDraft(socket, parsed.data.text);
  });
});

app.get("/api/health", (_request, response) => response.json({ status: "ok" }));
app.get("/api/challenges", (_request, response) => response.json(getTemplateChallenges()));

app.post("/api/admin/login", loginLimiter, (request, response) => {
  const parsed = z.object({ password: z.string().min(1).max(200) }).safeParse(request.body);
  if (!parsed.success || parsed.data.password !== adminPassword) {
    response.status(401).json({ error: "Incorrect organiser password." });
    return;
  }
  response.json({ token: issueAdminToken(tokenSecret) });
});

app.get("/api/admin/rooms", requireAdmin, (_request, response) => {
  response.json(roomSummaries().map((room) => ({
    code: room.code,
    name: room.name,
    status: room.status,
    round: room.round,
    participants: room.participants,
    totalPoints: room.total_points,
    createdAt: room.created_at
  })));
});

app.post("/api/admin/rooms", requireAdmin, (request, response) => {
  const parsed = createRoomSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid room details." });
    return;
  }
  const code = generateRoomCode((candidate) => game.hasRoom(candidate));
  const createdAt = new Date().toISOString();
  const challenges = [...parsed.data.challenges]
    .map((challenge) => ({
      ...challenge,
      duration: challenge.duration ?? ROUND_CONFIG[challenge.round].duration
    }))
    .sort((left, right) => left.round - right.round);
  saveRoom(code, parsed.data.name, "lobby", 1, createdAt);
  saveRoomChallenges(code, challenges);
  game.createRoom(code, parsed.data.name);
  response.status(201).json({
    code,
    name: parsed.data.name,
    status: "lobby",
    round: 1,
    participants: 0,
    totalPoints: 0,
    createdAt
  });
});

app.get("/api/admin/rooms/:code/scores", requireAdmin, (request, response) => {
  const code = getRoomCode(request);
  response.json(roomScoreRows(code).map((score) => ({
    participantId: score.participant_id,
    name: score.participant_name,
    usn: score.participant_usn,
    round: score.round,
    accuracy: score.accuracy,
    points: score.points,
    errors: score.errors
  })));
});

app.get("/api/admin/rooms/:code", requireAdmin, (request, response) => {
  const details = roomDetails(getRoomCode(request));
  if (!details.room) {
    response.status(404).json({ error: "Event not found." });
    return;
  }
  response.json({
    room: {
      code: details.room.code,
      name: details.room.name,
      status: details.room.status,
      round: details.room.round,
      createdAt: details.room.created_at,
      participants: details.participants.length,
      totalPoints: details.scores.reduce((total, score) => total + score.points, 0)
    },
    challenges: details.challenges.map((challenge) => ({
      round: challenge.round,
      referenceText: challenge.reference_text,
      duration: challenge.duration_seconds
    })),
    participants: details.participants,
    scores: details.scores.map((score) => ({
      participantId: score.participant_id,
      name: score.participant_name,
      usn: score.participant_usn,
      round: score.round,
      accuracy: score.accuracy,
      points: score.points,
      errors: score.errors
    }))
  });
});

app.patch("/api/admin/rooms/:code", requireAdmin, (request, response) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(60) }).safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid event name." });
    return;
  }
  const code = getRoomCode(request);
  if (!game.hasRoom(code)) {
    response.status(404).json({ error: "Event not found." });
    return;
  }
  try {
    game.renameCompletedRoom(code, parsed.data.name);
    response.json({ ok: true, name: parsed.data.name });
  } catch (error) {
    response.status(409).json({
      error: error instanceof Error ? error.message : "Unable to update the event."
    });
  }
});

app.delete("/api/admin/rooms/:code", requireAdmin, (request, response) => {
  const code = getRoomCode(request);
  if (!game.hasRoom(code)) {
    response.status(404).json({ error: "Event not found." });
    return;
  }
  try {
    game.deleteCompletedRoom(code);
    response.json({ ok: true });
  } catch (error) {
    response.status(409).json({
      error: error instanceof Error ? error.message : "Unable to delete the event."
    });
  }
});

app.post("/api/admin/rooms/:code/:action", requireAdmin, (request, response) => {
  const code = getRoomCode(request);
  const action = request.params.action;
  try {
    if (action === "start") game.start(code);
    else if (action === "pause") game.pause(code);
    else if (action === "end") game.end(code);
    else {
      response.status(404).json({ error: "Unknown room action." });
      return;
    }
    response.json({ ok: true });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to update room state."
    });
  }
});

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const clientDist = path.resolve(currentDir, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (_request, response, next) => {
  response.sendFile(path.join(clientDist, "index.html"), (error) => {
    if (error) next();
  });
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  console.error(error);
  response.status(500).json({ error: "Unexpected server error." });
});

httpServer.listen(port, "0.0.0.0", () => {
  console.info(`Blind Coding Challenge API listening on http://localhost:${port}`);
});
