import { randomInt, randomUUID } from "node:crypto";
import type { Server as SocketServer, Socket } from "socket.io";
import { ROUND_CONFIG } from "./challenges.js";
import {
  hasParticipantUsn,
  roomChallenges,
  roomParticipants,
  roomScoreRows,
  saveParticipant,
  saveRoomStatus,
  saveScores,
  updateRoomName,
  deleteRoom
} from "./database.js";
import { evaluateSubmission } from "./scoring.js";
import type {
  Participant,
  ParticipantInfo,
  RoomState,
  RoundNumber,
  ScoreInfo
} from "./types.js";

interface GameRoom {
  code: string;
  name: string;
  status: RoomState["status"];
  round: RoundNumber;
  challenges: Map<RoundNumber, string>;
  durations: Map<RoundNumber, number>;
  participants: Map<string, Participant>;
  scores: ScoreInfo[];
  remainingMs: number;
  endsAt: number | null;
  timeout?: NodeJS.Timeout;
  ticker?: NodeJS.Timeout;
}

export class GameManager {
  private readonly rooms = new Map<string, GameRoom>();

  constructor(private readonly io: SocketServer) {}

  createRoom(code: string, name: string): void {
    const challenges = roomChallenges(code);
    this.rooms.set(code, {
      code,
      name,
      status: "lobby",
      round: 1,
      challenges: new Map(challenges.map(({ round, referenceText }) => [round, referenceText])),
      durations: new Map(challenges.map(({ round, duration }) => [round, duration])),
      participants: new Map(),
      scores: [],
      remainingMs: (challenges.find(({ round }) => round === 1)?.duration ?? ROUND_CONFIG[1].duration) * 1000,
      endsAt: null
    });
  }

  restoreRoom(code: string, name: string, storedStatus: string, storedRound: number): void {
    this.createRoom(code, name);
    const room = this.rooms.get(code);
    if (!room) throw new Error(`Could not restore room ${code}.`);
    const savedScores = roomScoreRows(code).map((score) => ({
      participantId: score.participant_id,
      name: score.participant_name,
      round: score.round as RoundNumber,
      accuracy: score.accuracy,
      points: score.points,
      errors: score.errors
    }));
    room.scores = savedScores;
    for (const participant of roomParticipants(code)) {
      room.participants.set(participant.id, { ...participant, draft: "" });
    }
    for (const score of savedScores) {
      if (!room.participants.has(score.participantId)) {
        room.participants.set(score.participantId, {
          id: score.participantId,
          name: score.name,
          usn: `LEGACY-${score.participantId}`,
          draft: ""
        });
      }
    }

    const completedRound = savedScores.reduce((latest, score) => Math.max(latest, score.round), 0);
    if (storedStatus === "completed" || completedRound >= 3) {
      room.round = 3;
      room.status = "completed";
    } else if (completedRound > 0) {
      room.round = completedRound as RoundNumber;
      room.status = "between_rounds";
    } else {
      room.round = storedRound === 2 || storedRound === 3 ? storedRound : 1;
      room.status = "lobby";
    }
    room.remainingMs = this.durationFor(room, room.round) * 1000;
    saveRoomStatus(code, room.status, room.round);
  }

  hasRoom(code: string): boolean {
    return this.rooms.has(code);
  }

  joinParticipant(
    socket: Socket,
    code: string,
    participantName: string,
    participantUsn: string,
    requestedId?: string
  ): void {
    const room = this.rooms.get(code);
    if (!room || room.status === "completed") {
      socket.emit("action-error", { message: "This room is no longer accepting participants." });
      return;
    }

    let participant = requestedId ? room.participants.get(requestedId) : undefined;
    if (hasParticipantUsn(code, participantUsn, participant?.id)) {
      socket.emit("action-error", { message: "That USN is already registered in this room." });
      return;
    }
    if (!participant && room.status !== "lobby") {
      socket.emit("action-error", { message: "This round is underway. Ask the organiser to add you before it starts." });
      return;
    }
    if (participant) {
      participant.name = participantName;
      participant.usn = participantUsn;
    } else {
      participant = { id: randomUUID(), name: participantName, usn: participantUsn, draft: "" };
      room.participants.set(participant.id, participant);
    }
    saveParticipant(code, participant);

    socket.join(this.roomChannel(code));
    socket.data.role = "participant";
    socket.data.roomCode = code;
    socket.data.participantId = participant.id;
    socket.emit("joined", { participantId: participant.id });
    socket.emit("room-state", this.toState(room));
    this.broadcast(room);
  }

  joinAdmin(socket: Socket, code: string): void {
    const room = this.rooms.get(code);
    if (!room || socket.data.role !== "admin") {
      socket.emit("action-error", { message: "Room unavailable or organiser access required." });
      return;
    }
    socket.join(this.roomChannel(code));
    socket.data.roomCode = code;
    socket.emit("room-state", this.toState(room));
  }

  updateDraft(socket: Socket, text: string): void {
    const roomCode = socket.data.roomCode;
    const participantId = socket.data.participantId;
    const room = typeof roomCode === "string" ? this.rooms.get(roomCode) : undefined;
    const participant = room && typeof participantId === "string"
      ? room.participants.get(participantId)
      : undefined;
    if (!room || !participant || room.status !== "running" || text.length > 10_000 || !room.endsAt) return;
    if (Date.now() >= room.endsAt) {
      this.finalize(room);
      return;
    }
    participant.draft = text;
  }

  start(code: string): void {
    const room = this.requireRoom(code);
    if (room.status === "paused") {
      this.beginClock(room, room.remainingMs);
      return;
    }
    if (room.status !== "lobby" && room.status !== "between_rounds") {
      throw new Error("This round cannot be started in its current state.");
    }
    if (room.status === "between_rounds") {
      if (room.round >= 3) throw new Error("All rounds have already finished.");
      room.round = (room.round + 1) as RoundNumber;
    }
    room.remainingMs = this.durationFor(room, room.round) * 1000;
    for (const participant of room.participants.values()) participant.draft = "";
    room.status = "running";
    saveRoomStatus(code, room.status, room.round);
    this.beginClock(room, room.remainingMs);
  }

  pause(code: string): void {
    const room = this.requireRoom(code);
    if (room.status !== "running" || !room.endsAt) throw new Error("Only a running round can be paused.");
    room.remainingMs = Math.max(0, room.endsAt - Date.now());
    if (room.remainingMs === 0) {
      this.finalize(room);
      return;
    }
    this.stopClock(room);
    room.status = "paused";
    saveRoomStatus(code, room.status, room.round);
    this.broadcast(room);
  }

  end(code: string): void {
    const room = this.requireRoom(code);
    if (room.status !== "running" && room.status !== "paused") {
      throw new Error("Only an active round can be ended.");
    }
    this.finalize(room);
  }

  renameCompletedRoom(code: string, name: string): void {
    const room = this.requireRoom(code);
    if (room.status !== "completed") throw new Error("Only completed events can be renamed.");
    room.name = name;
    updateRoomName(code, name);
    this.broadcast(room);
  }

  deleteCompletedRoom(code: string): void {
    const room = this.requireRoom(code);
    if (room.status !== "completed") throw new Error("Only completed events can be deleted.");
    this.stopClock(room);
    this.io.to(this.roomChannel(code)).emit("action-error", {
      message: "This completed event was removed by the organiser."
    });
    this.io.in(this.roomChannel(code)).socketsLeave(this.roomChannel(code));
    deleteRoom(code);
    this.rooms.delete(code);
  }

  private beginClock(room: GameRoom, remainingMs: number): void {
    this.stopClock(room);
    room.status = "running";
    room.remainingMs = remainingMs;
    room.endsAt = Date.now() + remainingMs;
    saveRoomStatus(room.code, room.status, room.round);
    room.timeout = setTimeout(() => this.finalize(room), remainingMs);
    room.ticker = setInterval(() => this.broadcast(room), 1000);
    this.broadcast(room);
  }

  private finalize(room: GameRoom): void {
    if (room.status !== "running" && room.status !== "paused") return;
    this.stopClock(room);
    const reference = room.challenges.get(room.round);
    if (reference === undefined) throw new Error(`Missing reference text for round ${room.round}.`);

    const roundScores = Array.from(room.participants.values(), (participant) => {
      const result = evaluateSubmission(
        participant.draft,
        reference,
        ROUND_CONFIG[room.round].points
      );
      return {
        participantId: participant.id,
        name: participant.name,
        usn: participant.usn,
        round: room.round,
        ...result
      };
    });
    saveScores(room.code, roundScores);
    room.scores = room.scores.filter((score) => score.round !== room.round).concat(roundScores);
    room.remainingMs = 0;
    room.status = room.round === 3 ? "completed" : "between_rounds";
    saveRoomStatus(room.code, room.status, room.round);
    this.broadcast(room);
  }

  private stopClock(room: GameRoom): void {
    if (room.timeout) clearTimeout(room.timeout);
    if (room.ticker) clearInterval(room.ticker);
    room.timeout = undefined;
    room.ticker = undefined;
    room.endsAt = null;
  }

  private requireRoom(code: string): GameRoom {
    const room = this.rooms.get(code);
    if (!room) throw new Error("Room not found.");
    return room;
  }

  private toState(room: GameRoom): RoomState {
    const participants: ParticipantInfo[] = Array.from(room.participants.values(), (participant) => {
      const ownScores = room.scores.filter((score) => score.participantId === participant.id);
      return {
        id: participant.id,
        name: participant.name,
        totalPoints: Math.round(ownScores.reduce((total, score) => total + score.points, 0) * 100) / 100,
        roundsCompleted: ownScores.length
      };
    }).sort((left, right) => right.totalPoints - left.totalPoints || left.name.localeCompare(right.name));

    const state: RoomState = {
      code: room.code,
      name: room.name,
      status: room.status,
      round: room.round,
      remainingMs: room.status === "running" && room.endsAt
        ? Math.max(0, room.endsAt - Date.now())
        : room.remainingMs,
      serverTime: Date.now(),
      participants,
      scores: [...room.scores].sort((left, right) => left.round - right.round),
      ...(room.status !== "lobby"
        ? {
            challenge: {
              round: room.round,
                      ...ROUND_CONFIG[room.round],
                      duration: this.durationFor(room, room.round),
                      referenceText: room.challenges.get(room.round) ?? ""
            }
          }
        : {})
    };
    return state;
  }

  private durationFor(room: GameRoom, round: RoundNumber): number {
    const duration = room.durations.get(round);
    if (!duration) throw new Error(`Missing duration for round ${round}.`);
    return duration;
  }

  private broadcast(room: GameRoom): void {
    this.io.to(this.roomChannel(room.code)).emit("room-state", this.toState(room));
  }

  private roomChannel(code: string): string {
    return `room:${code}`;
  }
}

export function generateRoomCode(existing: (code: string) => boolean): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
    if (!existing(code)) return code;
  }
  throw new Error("Unable to allocate a unique room code. Try again.");
}
