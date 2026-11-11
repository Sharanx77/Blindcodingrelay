export type RoundNumber = 1 | 2 | 3;
export type RoomStatus = "lobby" | "running" | "paused" | "between_rounds" | "completed";

export interface RoundInfo {
  round: RoundNumber;
  title: string;
  duration: number;
  points: number;
  referenceText: string;
}

export interface ScoreInfo {
  participantId: string;
  name: string;
  round: RoundNumber;
  accuracy: number;
  points: number;
  errors: number;
}

export interface ParticipantInfo {
  id: string;
  name: string;
  totalPoints: number;
  roundsCompleted: number;
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

export interface Participant {
  id: string;
  name: string;
  usn: string;
  draft: string;
}

export interface RoomChallenge {
  round: RoundNumber;
  referenceText: string;
  duration: number;
}
