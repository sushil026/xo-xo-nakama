import { Client, type Socket, type Session } from "@heroiclabs/nakama-js";
import config from "../config";

const client = new Client(
  "defaultkey",
  config.nakama.host,
  config.nakama.port,
  config.nakama.ssl,
);

let _socket: Socket | null = null;
let _session: Session | null = null;
let _connectGen = 0;

export const getSocket = (): Socket => {
  if (!_socket)
    throw new Error("Socket not initialised. Call connect() first.");
  return _socket;
};

export const getConnectGen = () => _connectGen;

//  Types

export interface ConnectResult {
  socket: Socket;
  session: Session;
  username: string | null;
  deviceId: string;
  gen: number;
}

export interface UserProfile {
  username: string;
  wins: number;
  losses: number;
  draws: number;
  rating: number;
  winStreak: number;
  bestStreak: number;
  /** Total games played — used for provisional rating phase (first 10 games). */
  gamesPlayed: number;
}

/**
 * Per-cell breakdown: [wins, losses, draws] for each of the 9 board cells.
 * openingStats  — outcome when this cell was YOUR first move
 * cellHeatmap   — outcome whenever you played this cell (any move)
 */
export interface UserAnalytics {
  openingStats: [number, number, number][]; // 9 cells × [W, L, D]
  cellHeatmap: [number, number, number][]; // 9 cells × [W, L, D]
  totalMoves: number;
  avgMovesPerGame: number;
  timeoutLosses: number;
  forfeitLosses: number;
  gamesPlayed: number;
}

export interface StoredMatch {
  matchId: string;
  players: { userId: string; symbol: "X" | "O" }[];
  moves: number[];
  winner: string | null; // "X" | "O" | "draw"
  endReason: "win" | "draw" | "timeout" | "forfeit";
  gameMode: "matchmaker" | "room_public" | "room_private";
  openingCell: number | null; // first move cell index (0-8), null if no moves
  createdAt: number;
}

export interface MatchHistory {
  matches: string[]; // match IDs, newest first
}

export interface LeaderboardEntry {
  owner_id: string;
  rank: number;
  username: string;
  userId: string;
  score: number; // rating (primary sort)
  subscore: number; // composite tiebreaker (wins/loss ratio encoded)
  wins: number; // from profile fetch — used for display only
  losses: number;
  draws: number;
}

/**
 * A single data point for the rating progression graph.
 * `game` is the sequential game number (1-based).
 * `rating` is the rating *after* that game resolved.
 */
export interface RatingPoint {
  game: number;
  rating: number;
  outcome: "win" | "loss" | "draw";
}

//  Device / Connect

const getOrCreateDeviceId = (): string => {
  const existing = localStorage.getItem("xo_device_id");
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem("xo_device_id", id);
  return id;
};

export const connect = async (): Promise<ConnectResult> => {
  const deviceId = getOrCreateDeviceId();
  const gen = ++_connectGen;

  if (_socket && _session) {
    return {
      socket: _socket,
      session: _session,
      username: localStorage.getItem("xo_username"),
      deviceId,
      gen,
    };
  }

  const session = await client.authenticateDevice(deviceId, true);
  const socket = client.createSocket(config.nakama.ssl, false);
  await socket.connect(session, true);

  socket.ondisconnect = () => {
    _socket = null;
    _session = null;
  };

  _socket = socket;
  _session = session;

  let username: string | null = null;
  try {
    const res = await client.readStorageObjects(session, {
      object_ids: [
        { collection: "profile", key: "data", user_id: session.user_id! },
      ],
    });
    if (res.objects?.length) {
      username = (res.objects[0].value as UserProfile).username;
    }
  } catch {
    username = null;
  }

  return { socket, session, username, deviceId, gen };
};

export const disconnect = async (): Promise<void> => {
  const s = _socket;
  _socket = null;
  _session = null;
  try {
    await s?.disconnect(false);
  } catch {
    // ignore
  }
};

//  Profile

export const setupUser = async (
  session: Session,
  desiredUsername: string,
): Promise<string> => {
  const clean = desiredUsername
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .slice(0, 16);

  let finalUsername = clean;

  try {
    await client.updateAccount(session, {
      username: clean,
      display_name: clean,
    });
  } catch {
    const suffix = String(Math.floor(Math.random() * 9000) + 1000);
    finalUsername = `${clean.slice(0, 11)}_${suffix}`;
    await client.updateAccount(session, {
      username: finalUsername,
      display_name: finalUsername,
    });
  }

  const blankAnalytics: UserAnalytics = {
    openingStats: Array(9).fill([0, 0, 0]),
    cellHeatmap: Array(9).fill([0, 0, 0]),
    totalMoves: 0,
    avgMovesPerGame: 0,
    timeoutLosses: 0,
    forfeitLosses: 0,
    gamesPlayed: 0,
  };

  await client.writeStorageObjects(session, [
    {
      collection: "profile",
      key: "data",
      value: {
        username: finalUsername,
        wins: 0,
        losses: 0,
        draws: 0,
        rating: 800, // provisional start — every point earned, not gifted
        winStreak: 0,
        bestStreak: 0,
        gamesPlayed: 0, // tracks provisional phase (first 10 games = high volatility)
      } satisfies UserProfile,
      permission_read: 2,
      permission_write: 1,
    },
    {
      collection: "analytics",
      key: "data",
      value: blankAnalytics,
      permission_read: 1,
      permission_write: 1,
    },
  ]);

  localStorage.setItem("xo_username", finalUsername);
  return finalUsername;
};

export const getProfile = async (
  session: Session,
): Promise<UserProfile | null> => {
  const res = await client.readStorageObjects(session, {
    object_ids: [
      { collection: "profile", key: "data", user_id: session.user_id! },
    ],
  });
  return (res.objects?.[0]?.value as UserProfile) ?? null;
};

export const updateProfile = async (
  session: Session,
  patch: Partial<Omit<UserProfile, "username">>,
): Promise<void> => {
  const current = await getProfile(session);
  if (!current) return;
  await client.writeStorageObjects(session, [
    {
      collection: "profile",
      key: "data",
      value: { ...current, ...patch },
      permission_read: 2,
      permission_write: 1,
    },
  ]);
};

//  Analytics

export const getAnalytics = async (
  session: Session,
): Promise<UserAnalytics | null> => {
  const res = await client.readStorageObjects(session, {
    object_ids: [
      { collection: "analytics", key: "data", user_id: session.user_id! },
    ],
  });
  return (res.objects?.[0]?.value as UserAnalytics) ?? null;
};

/**
 * Called client-side after a game ends with full match data available.
 * Updates openingStats, cellHeatmap, and aggregate counters in analytics/data.
 *
 * This is the ONLY storage write the client should make after a match.
 * Profile stats and leaderboard scores are updated exclusively by the server
 * inside saveMatchResult (match_handler.js) — do not duplicate them here.
 */
export const recordMatchAnalytics = async (
  session: Session,
  match: StoredMatch,
  mySymbol: "X" | "O",
): Promise<void> => {
  const current = await getAnalytics(session);
  const analytics: UserAnalytics = current ?? {
    openingStats: Array(9).fill([0, 0, 0]),
    cellHeatmap: Array(9).fill([0, 0, 0]),
    totalMoves: 0,
    avgMovesPerGame: 0,
    timeoutLosses: 0,
    forfeitLosses: 0,
    gamesPlayed: 0,
  };

  // Deep-clone arrays so we can mutate safely
  const openingStats = analytics.openingStats.map(
    (c) => [...c] as [number, number, number],
  );
  const cellHeatmap = analytics.cellHeatmap.map(
    (c) => [...c] as [number, number, number],
  );

  // Outcome index: 0 = win, 1 = loss, 2 = draw
  let outcomeIdx: 0 | 1 | 2;
  if (match.winner === "draw") {
    outcomeIdx = 2;
  } else if (match.winner === mySymbol) {
    outcomeIdx = 0;
  } else {
    outcomeIdx = 1;
  }

  // X moves on even sequence indices (0, 2, 4…), O on odd (1, 3, 5…)
  const myMoveIndices = match.moves.filter((_, seqIdx) =>
    mySymbol === "X" ? seqIdx % 2 === 0 : seqIdx % 2 === 1,
  );

  if (myMoveIndices.length > 0) {
    const openingCell = myMoveIndices[0];
    openingStats[openingCell][outcomeIdx] += 1;
  }

  for (const cell of myMoveIndices) {
    cellHeatmap[cell][outcomeIdx] += 1;
  }

  const newGames = analytics.gamesPlayed + 1;
  const newTotalMoves = analytics.totalMoves + myMoveIndices.length;

  const updated: UserAnalytics = {
    openingStats,
    cellHeatmap,
    totalMoves: newTotalMoves,
    avgMovesPerGame: Math.round((newTotalMoves / newGames) * 10) / 10,
    timeoutLosses:
      analytics.timeoutLosses +
      (match.endReason === "timeout" && outcomeIdx === 1 ? 1 : 0),
    forfeitLosses:
      analytics.forfeitLosses +
      (match.endReason === "forfeit" && outcomeIdx === 1 ? 1 : 0),
    gamesPlayed: newGames,
  };

  await client.writeStorageObjects(session, [
    {
      collection: "analytics",
      key: "data",
      value: updated,
      permission_read: 1,
      permission_write: 1,
    },
  ]);
};

//  Match History

export const getMatchIdList = async (session: Session): Promise<string[]> => {
  const res = await client.readStorageObjects(session, {
    object_ids: [
      { collection: "user_matches", key: "list", user_id: session.user_id! },
    ],
  });
  if (!res.objects?.length) return [];
  return (res.objects[0].value as MatchHistory)?.matches ?? [];
};

export const getMatchById = async (
  session: Session,
  matchId: string,
): Promise<StoredMatch | null> => {
  const res = await client.readStorageObjects(session, {
    object_ids: [{ collection: "matches", key: matchId }],
  });
  return (res.objects?.[0]?.value as StoredMatch) ?? null;
};

/**
 * Returns the N most recent matches (full objects), newest first.
 */
export const getRecentMatches = async (
  session: Session,
  limit = 20,
): Promise<StoredMatch[]> => {
  const ids = await getMatchIdList(session);
  const page = ids.slice(0, limit);
  const results = await Promise.all(
    page.map((id) => getMatchById(session, id)),
  );
  return results.filter((m): m is StoredMatch => m !== null);
};

/**
 * Reconstruct a RatingPoint[] series from stored match history.
 *
 * Since we don't store per-game rating snapshots, we replay the provisional
 * rating formula forward from the starting rating to approximate the curve.
 * This is accurate for accounts created after the 800-start change; older
 * accounts with different starting ratings will show an approximation.
 *
 * Returns points sorted oldest→newest (ascending by createdAt), ready for
 * the RatingGraph component.
 */
export const getRatingHistory = async (
  session: Session,
  myUserId: string,
  limit = 50,
): Promise<RatingPoint[]> => {
  const matches = await getRecentMatches(session, limit);
  if (!matches.length) return [];

  // getRecentMatches returns newest-first; reverse to get oldest-first
  const chronological = [...matches].reverse();

  const PROVISIONAL = 3;
  let rating = 800;
  let gameNum = 0;
  const points: RatingPoint[] = [];

  for (const match of chronological) {
    const myPlayer = match.players.find((p) => p.userId === myUserId);
    if (!myPlayer) continue;

    gameNum++;
    const isEarly = gameNum <= PROVISIONAL;

    let outcome: "win" | "loss" | "draw";
    if (match.winner === "draw") {
      outcome = "draw";
    } else if (match.winner === myPlayer.symbol) {
      outcome = "win";
    } else {
      outcome = "loss";
    }

    if (outcome === "win") {
      rating += isEarly ? 30 : 10;
    } else if (outcome === "loss") {
      rating = Math.max(0, rating - (isEarly ? 15 : 5));
    }
    // draws: no rating change

    points.push({ game: gameNum, rating, outcome });
  }

  return points;
};

//  Leaderboard

/**
 * @deprecated DO NOT call this after a match ends.
 *
 * Leaderboard scores are written exclusively by the server inside
 * saveMatchResult (match_handler.js → submitLeaderboard). Calling this from
 * the client after a match duplicates the server write and opens a cheating
 * vector where a client could submit arbitrary win counts.
 *
 * Safe uses: one-time data migration / backfill scripts run in a trusted
 * environment. Never call from game flow.
 */
export const submitLeaderboardScore = async (
  session: Session,
  wins: number,
  rating: number,
): Promise<void> => {
  await Promise.all([
    client.writeLeaderboardRecord(session, "xo_alltime", {
      score: String(rating),
      subscore: String(wins),
    }),
    client.writeLeaderboardRecord(session, "xo_monthly", {
      score: String(rating),
      subscore: String(wins),
    }),
  ]);
};

export const getLeaderboard = async (
  session: Session,
  boardId: "xo_alltime" | "xo_monthly",
  limit = 50,
): Promise<LeaderboardEntry[]> => {
  const res = await client.listLeaderboardRecords(session, boardId, [], limit);
  const records = res.records ?? [];

  // Build initial entries. username may be empty for pre-fix records.
  const entries: LeaderboardEntry[] = records.map((r, i) => ({
    owner_id: r.owner_id ?? "",
    rank: Number(r.rank ?? i + 1),
    username: r.username || "",
    userId: r.owner_id ?? "",
    score: Number(r.score ?? 0), // rating
    subscore: Number(r.subscore ?? 0), // encoded tiebreaker
    wins: 0,
    losses: 0,
    draws: 0,
  }));

  // Collect all userIds to batch-fetch: those missing names + all for profile data
  const allIds = entries.map((e) => e.userId).filter(Boolean);
  const missingNameIds = entries
    .filter((e) => !e.username && e.userId)
    .map((e) => e.userId);

  // Batch resolve missing usernames
  if (missingNameIds.length > 0) {
    try {
      const users = await client.getUsers(session, missingNameIds);
      const nameMap = new Map<string, string>();
      for (const u of users.users ?? []) {
        const name =
          u.display_name || u.username || u.id?.slice(0, 8) || "Unknown";
        if (u.id) nameMap.set(u.id, name);
      }
      for (const entry of entries) {
        if (!entry.username) {
          entry.username =
            nameMap.get(entry.userId) ?? entry.userId.slice(0, 8);
        }
      }
    } catch {
      for (const entry of entries) {
        if (!entry.username) entry.username = entry.userId.slice(0, 8);
      }
    }
  }

  // Batch-fetch profile/data for all entries to get w/l/d
  if (allIds.length > 0) {
    try {
      const profileRes = await client.readStorageObjects(session, {
        object_ids: allIds.map((uid) => ({
          collection: "profile",
          key: "data",
          user_id: uid,
        })),
      });
      const profileMap = new Map<
        string,
        { wins: number; losses: number; draws: number }
      >();
      for (const obj of profileRes.objects ?? []) {
        const v = obj.value as any;
        profileMap.set(obj.user_id ?? "", {
          wins: Number(v.wins ?? 0),
          losses: Number(v.losses ?? 0),
          draws: Number(v.draws ?? 0),
        });
      }
      for (const entry of entries) {
        const p = profileMap.get(entry.userId);
        if (p) {
          entry.wins = p.wins;
          entry.losses = p.losses;
          entry.draws = p.draws;
        }
      }
    } catch {
      // Non-fatal — w/l/d stays at 0
    }
  }

  return entries;
};

/** Fetch the calling user's own record on a board (rank + score + w/l/d). */
export const getMyLeaderboardRecord = async (
  session: Session,
  boardId: "xo_alltime" | "xo_monthly",
): Promise<LeaderboardEntry | null> => {
  const res = await client.listLeaderboardRecords(
    session,
    boardId,
    [session.user_id!],
    1,
  );
  const r = res.owner_records?.[0];
  if (!r) return null;

  let username = r.username || "";
  if (!username) {
    username = localStorage.getItem("xo_username") ?? "You";
  }

  // Also fetch own profile for w/l/d
  let wins = 0,
    losses = 0,
    draws = 0;
  try {
    const profileRes = await client.readStorageObjects(session, {
      object_ids: [
        { collection: "profile", key: "data", user_id: session.user_id! },
      ],
    });
    const v = profileRes.objects?.[0]?.value as any;
    if (v) {
      wins = Number(v.wins ?? 0);
      losses = Number(v.losses ?? 0);
      draws = Number(v.draws ?? 0);
    }
  } catch {
    /* non-fatal */
  }

  return {
    owner_id: r.owner_id ?? "",
    rank: Number(r.rank ?? 0),
    username,
    userId: r.owner_id ?? "",
    score: Number(r.score ?? 0), // rating
    subscore: Number(r.subscore ?? 0), // wins (tiebreaker)
    wins,
    losses,
    draws,
  };
};

//  Room types

export interface RoomInfo {
  matchId: string;
  roomCode: string | null;
  isPublic: boolean;
  size: number;
  hostUserId: string | null;
  hostUsername: string | null;
  createdAt: number;
}

export interface CreateRoomResult {
  matchId: string;
  roomCode: string;
  isPublic: boolean;
}

export type JoinByCodeResult =
  | { ok: true; matchId: string }
  | { ok: false; error: "not_found" | "full" | "unknown" };

//  Room functions

/**
 * List open public rooms (label = "waiting_public", 1 player slot filled).
 * Uses Nakama's native listMatches which filters by label server-side —
 * private rooms (label "waiting_private") never appear here.
 *
 * Returns rooms sorted newest-first based on the label; Nakama doesn't
 * expose createdAt natively so we use match metadata when available.
 */
export const listOpenRooms = async (
  session: Session,
  limit = 20,
): Promise<RoomInfo[]> => {
  const res = await client.listMatches(
    session,
    limit,
    true, // authoritative only
    "waiting_public", // label filter — exact match
    1, // minSize: at least the host is in
    1, // maxSize: still has a free slot (not yet 2)
    "*",
  );

  const matches = res.matches ?? [];

  return matches.map((m) => {
    // Nakama match metadata is stored as a JSON string in m.label
    // We keep label clean for filtering, so metadata comes from match properties
    const meta = (m as any).metadata ?? {};
    return {
      matchId: m.match_id ?? "",
      roomCode: meta.roomCode ?? "",
      isPublic: true,
      size: m.size ?? 1,
      // FIX: hostUserId was missing from this object, causing TS2741
      hostUserId: meta.hostUserId ?? null,
      hostUsername: meta.hostUsername ?? null,
      createdAt: meta.createdAt ?? 0,
    } satisfies RoomInfo;
  });
};

/**
 * Call xo_create_room RPC.
 * Server creates the match, generates the code, writes rooms/{code}.
 * Returns matchId + roomCode. Client must then call socket.joinMatch(matchId).
 */
export const createRoom = async (
  session: Session,
  isPublic: boolean,
): Promise<CreateRoomResult> => {
  const res = await client.rpc(session, "xo_create_room", {
    isPublic,
    gameMode: isPublic ? "room_public" : "room_private",
  });
  return res.payload as CreateRoomResult;
};

/**
 * Call xo_join_by_code RPC.
 * Server looks up rooms/{code} under SYSTEM_USER_ID and validates the match.
 * Returns { ok: true, matchId } or { ok: false, error }.
 * Client must then call socket.joinMatch(matchId) on ok:true.
 */
export const joinByCode = async (
  session: Session,
  roomCode: string,
): Promise<JoinByCodeResult> => {
  try {
    const res = await client.rpc(session, "xo_join_by_code", {
      roomCode: roomCode.toUpperCase().replace(/[^A-Z0-9]/g, ""),
    });
    const payload = res.payload as { matchId?: string; error?: string };
    if (payload.error) {
      const err = payload.error as "not_found" | "full";
      return { ok: false, error: err ?? "unknown" };
    }
    return { ok: true, matchId: payload.matchId! };
  } catch {
    return { ok: false, error: "unknown" };
  }
};

/**
 * Call xo_list_public_rooms RPC.
 * Server returns only "waiting_public" matches with 1 player.
 * Private rooms NEVER appear here because the filter happens server-side.
 *
 * hostUserId is included so the caller can filter out their own room:
 *   const others = rooms.filter(r => r.hostUserId !== session.user_id);
 */
export const listPublicRooms = async (
  session: Session,
): Promise<RoomInfo[]> => {
  const res = await client.rpc(session, "xo_list_public_rooms", {});
  const payload = res.payload as { rooms: RoomInfo[] };
  return payload.rooms ?? [];
};

export { client };
