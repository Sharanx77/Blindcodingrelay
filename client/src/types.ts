export type RoundNumber = 1 | 2 | 3;
export type RoomStatus = "lobby" | "running" | "paused" | "between_rounds" | "completed";

export interface RoundInfo {
  round: RoundNumber;
  title: string;
  duration: number;
  points: number;
  referenceText: string;
}

export interface ParticipantInfo {
  id: string;
  name: string;
  totalPoints: number;
  roundsCompleted: number;
}

export interface ScoreInfo {
  participantId: string;
  name: string;
  round: RoundNumber;
  accuracy: number;
  points: number;
  errors: number;
}

export interface RoomDetail {
  room: RoomSummary;
  challenges: Array<{
    round: RoundNumber;
    referenceText: string;
    duration: number;
  }>;
  participants: Array<{ id: string; name: string; usn: string }>;
  scores: Array<ScoreInfo & { usn: string }>;
}

export interface RoomState {
  code: string;
  name: string;
  status: RoomStatus;
  round: RoundNumber;
  remainingMs: number;
  serverTime: number;
  participants: ParticipantInfo[];
  scores: ScoreInfo[];
  challenge?: RoundInfo;
}

export interface RoomSummary {
  code: string;
  name: string;
  status: RoomStatus;
  round: RoundNumber;
  participants: number;
  totalPoints: number;
  createdAt: string;
}
