import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database as SqlDatabase, type SqlJsStatic, type SqlValue } from "sql.js";
import { CHALLENGE_SEEDS, ROUND_CONFIG } from "./challenges.js";

let database: SqlDatabase;
let sql: SqlJsStatic;
let databasePath: string;

export async function initializeDatabase(): Promise<void> {
  sql = await initSqlJs();
  databasePath = path.resolve(process.cwd(), process.env.DATABASE_PATH ?? "server/data/challenge.sqlite");
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  if (fs.existsSync(databasePath)) {
    database = new sql.Database(fs.readFileSync(databasePath));
  } else {
    database = new sql.Database();
  }

  database.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS challenge_templates (
      round INTEGER PRIMARY KEY,
      reference_text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      round INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS room_challenges (
      room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      round INTEGER NOT NULL,
      reference_text TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL DEFAULT 30,
      PRIMARY KEY (room_code, round)
    );
    CREATE TABLE IF NOT EXISTS participants (
      id TEXT NOT NULL,
      room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      name TEXT NOT NULL,
      usn TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (room_code, id),
      UNIQUE (room_code, usn)
    );
    CREATE TABLE IF NOT EXISTS scores (
      room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      participant_id TEXT NOT NULL,
      participant_name TEXT NOT NULL,
      round INTEGER NOT NULL,
      accuracy REAL NOT NULL,
      points REAL NOT NULL,
      errors INTEGER NOT NULL,
      submitted_at TEXT NOT NULL,
      PRIMARY KEY (room_code, participant_id, round)
    );
  `);

  const challengeColumns = all<{ name: string }>("PRAGMA table_info(room_challenges)");
  if (!challengeColumns.some((column) => column.name === "duration_seconds")) {
    database.run("ALTER TABLE room_challenges ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 30");
    for (const challenge of CHALLENGE_SEEDS) {
      database.run("UPDATE room_challenges SET duration_seconds = ? WHERE round = ?", [
        ROUND_CONFIG[challenge.round].duration, challenge.round
      ]);
    }
  }

  const existingScoreParticipants = all<{
    room_code: string;
    participant_id: string;
    participant_name: string;
  }>(`
    SELECT DISTINCT room_code, participant_id, participant_name
    FROM scores
  `);
  for (const participant of existingScoreParticipants) {
    database.run(
      `INSERT OR IGNORE INTO participants (id, room_code, name, usn, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        participant.participant_id,
        participant.room_code,
        participant.participant_name,
        `LEGACY-${participant.participant_id}`,
        new Date().toISOString()
      ]
    );
  }

  for (const challenge of CHALLENGE_SEEDS) {
    database.run(
      "INSERT OR IGNORE INTO challenge_templates (round, reference_text) VALUES (?, ?)",
      [challenge.round, challenge.referenceText]
    );
  }
  persist();
}

export function run(sqlText: string, values: SqlValue[] = []): void {
  database.run(sqlText, values);
  persist();
}

export function all<T>(sqlText: string, values: SqlValue[] = []): T[] {
  const statement = database.prepare(sqlText);
  try {
    statement.bind(values);
    const results: T[] = [];
    while (statement.step()) results.push(statement.getAsObject() as T);
    return results;
  } finally {
    statement.free();
  }
}

export function first<T>(sqlText: string, values: SqlValue[] = []): T | undefined {
  return all<T>(sqlText, values)[0];
}

export function transaction(callback: () => void): void {
  database.run("BEGIN TRANSACTION");
  try {
    callback();
    database.run("COMMIT");
    persist();
  } catch (error) {
    database.run("ROLLBACK");
    throw error;
  }
}

export function getTemplateChallenges(): Array<{ round: 1 | 2 | 3; referenceText: string }> {
  return all<{ round: 1 | 2 | 3; reference_text: string }>(
    "SELECT round, reference_text FROM challenge_templates ORDER BY round"
  ).map(({ round, reference_text }) => ({ round, referenceText: reference_text }));
}

export function saveRoom(code: string, name: string, status: string, round: number, createdAt: string): void {
  run("INSERT INTO rooms (code, name, status, round, created_at) VALUES (?, ?, ?, ?, ?)", [
    code, name, status, round, createdAt
  ]);
}

export function saveRoomChallenges(
  code: string,
  challenges: Array<{ round: number; referenceText: string; duration: number }>
): void {
  transaction(() => {
    for (const challenge of challenges) {
      database.run(
        "INSERT INTO room_challenges (room_code, round, reference_text, duration_seconds) VALUES (?, ?, ?, ?)",
        [
          code, challenge.round, challenge.referenceText, challenge.duration
        ]
      );
    }
  });
}

export function saveParticipant(
  roomCode: string,
  participant: { id: string; name: string; usn: string }
): void {
  run(
    `INSERT INTO participants (id, room_code, name, usn, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(room_code, id) DO UPDATE SET name = excluded.name, usn = excluded.usn`,
    [participant.id, roomCode, participant.name, participant.usn, new Date().toISOString()]
  );
}

export function hasParticipantUsn(roomCode: string, usn: string, excludeId?: string): boolean {
  const row = first<{ present: number }>(
    `SELECT 1 AS present FROM participants
     WHERE room_code = ? AND usn = ? AND (? IS NULL OR id != ?) LIMIT 1`,
    [roomCode, usn, excludeId ?? null, excludeId ?? ""]
  );
  return Boolean(row);
}

export function roomParticipants(roomCode: string): Array<{ id: string; name: string; usn: string }> {
  return all(
    "SELECT id, name, usn FROM participants WHERE room_code = ? ORDER BY created_at",
    [roomCode]
  );
}

export function updateRoomName(code: string, name: string): void {
  run("UPDATE rooms SET name = ? WHERE code = ?", [name, code]);
}

export function deleteRoom(code: string): void {
  transaction(() => {
    database.run("DELETE FROM scores WHERE room_code = ?", [code]);
    database.run("DELETE FROM rooms WHERE code = ?", [code]);
  });
}

export function roomDetails(code: string): {
  room: { code: string; name: string; status: string; round: number; created_at: string } | undefined;
  challenges: Array<{ round: number; reference_text: string; duration_seconds: number }>;
  participants: Array<{ id: string; name: string; usn: string }>;
  scores: Array<{
    participant_id: string;
    participant_name: string;
    participant_usn: string;
    round: number;
    accuracy: number;
    points: number;
    errors: number;
  }>;
} {
  return {
    room: first("SELECT code, name, status, round, created_at FROM rooms WHERE code = ?", [code]),
    challenges: all(
      "SELECT round, reference_text, duration_seconds FROM room_challenges WHERE room_code = ? ORDER BY round",
      [code]
    ),
    participants: all(
      "SELECT id, name, usn FROM participants WHERE room_code = ? ORDER BY name",
      [code]
    ),
    scores: all(
      `SELECT s.participant_id, s.participant_name, p.usn AS participant_usn,
        s.round, s.accuracy, s.points, s.errors
       FROM scores s
       LEFT JOIN participants p ON p.room_code = s.room_code AND p.id = s.participant_id
       WHERE s.room_code = ?
       ORDER BY s.participant_name, s.round`,
      [code]
    )
  };
}

export function saveRoomStatus(code: string, status: string, round: number): void {
  run("UPDATE rooms SET status = ?, round = ? WHERE code = ?", [status, round, code]);
}

export function saveScores(
  roomCode: string,
  scores: Array<{
    participantId: string;
    name: string;
    usn: string;
    round: number;
    accuracy: number;
    points: number;
    errors: number;
  }>
): void {
  transaction(() => {
    for (const score of scores) {
      database.run(
        `INSERT OR REPLACE INTO scores
         (room_code, participant_id, participant_name, round, accuracy, points, errors, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          roomCode, score.participantId, score.name, score.round,
          score.accuracy, score.points, score.errors, new Date().toISOString()
        ]
      );
    }
  });
}

export function roomChallenges(code: string): Array<{
  round: 1 | 2 | 3;
  referenceText: string;
  duration: number;
}> {
  return all<{
    round: 1 | 2 | 3;
    reference_text: string;
    duration_seconds: number;
  }>(
    "SELECT round, reference_text, duration_seconds FROM room_challenges WHERE room_code = ? ORDER BY round",
    [code]
  ).map(({ round, reference_text, duration_seconds }) => ({
    round,
    referenceText: reference_text,
    duration: duration_seconds
  }));
}

export function roomSummaries(): Array<{
  code: string;
  name: string;
  status: string;
  round: number;
  participants: number;
  total_points: number;
  created_at: string;
}> {
  return all(`
    SELECT r.code, r.name, r.status, r.round, r.created_at,
      COUNT(DISTINCT p.id) AS participants,
      COALESCE(SUM(s.points), 0) AS total_points
    FROM rooms r
    LEFT JOIN participants p ON p.room_code = r.code
    LEFT JOIN scores s ON s.room_code = r.code AND s.participant_id = p.id
    GROUP BY r.code
    ORDER BY r.created_at DESC
  `);
}

export function roomScoreRows(code: string): Array<{
  participant_id: string;
  participant_name: string;
  participant_usn: string;
  round: number;
  accuracy: number;
  points: number;
  errors: number;
}> {
  return all(
    `SELECT s.participant_id, s.participant_name, p.usn AS participant_usn,
      s.round, s.accuracy, s.points, s.errors
     FROM scores s
     LEFT JOIN participants p ON p.room_code = s.room_code AND p.id = s.participant_id
     WHERE s.room_code = ?
     ORDER BY s.participant_name, s.round`,
    [code]
  );
}

function persist(): void {
  fs.writeFileSync(databasePath, Buffer.from(database.export()));
}

export function seedDatabase(): void {
  for (const challenge of CHALLENGE_SEEDS) {
    database.run(
      "INSERT OR REPLACE INTO challenge_templates (round, reference_text) VALUES (?, ?)",
      [challenge.round, challenge.referenceText]
    );
    console.info(`Seeded round ${challenge.round} — ${ROUND_CONFIG[challenge.round].title}`);
  }
  persist();
}
