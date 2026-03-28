import { Client, type Socket, type Session } from "@heroiclabs/nakama-js";
import config from "../config";

// Singleton client
const client = new Client(
  "defaultkey",
  config.nakama.host,
  config.nakama.port,
  config.nakama.ssl,
);

// Module-level socket — exported for use in match handlers
let _socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (!_socket)
    throw new Error("Socket not initialised. Call connect() first.");
  return _socket;
};

// Types

export interface ConnectResult {
  socket: Socket;
  session: Session;
  /**
   * null  → new user (never called setupUser)
   * string → returning user's chosen username
   */
  username: string | null;
  deviceId: string;
}

export interface UserProfile {
  username: string;
  wins: number;
  losses: number;
  draws: number;
  rating: number;
}

export interface MatchHistory {
  matches: unknown[];
}

//  Device ID
// Stable across sessions; survives app restarts.
// On Capacitor this lives in the native storage layer via localStorage bridge.

const getOrCreateDeviceId = (): string => {
  const existing = localStorage.getItem("xo_device_id");
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem("xo_device_id", id);
  return id;
};

//  connect
/**
 * 1. Get / create a stable deviceId
 * 2. Authenticate with Nakama (device auth creates account on first call,
 *    retrieves it on subsequent calls — idempotent)
 * 3. Open a real-time socket
 * 4. Read the "profile" storage object to decide new vs returning user.
 *    Nakama auto-assigns a random username on account creation, so we
 *    cannot rely on account.user.username to detect first-time users.
 */
export const connect = async (): Promise<ConnectResult> => {
  const deviceId = getOrCreateDeviceId();

  // Auth — create: true means create account if it doesn't exist
  const session = await client.authenticateDevice(deviceId, true);

  // Open real-time socket
  const socket = client.createSocket(config.nakama.ssl, false);
  await socket.connect(session, true);
  _socket = socket;

  // Check for an existing profile to determine new vs returning user
  let username: string | null = null;
  try {
    const storageResult = await client.readStorageObjects(session, {
      object_ids: [
        {
          collection: "profile",
          key: "data",
          user_id: session.user_id!,
        },
      ],
    });

    if (storageResult.objects && storageResult.objects.length > 0) {
      const profile = storageResult.objects[0].value as UserProfile;
      username = profile.username ?? null;
    }
  } catch {
    // Storage read failure → treat as new user
    username = null;
  }

  return { socket, session, username, deviceId };
};

// setupUser
/**
 * Called once for new users after they choose a callsign.
 * Handles duplicate usernames by appending a random suffix.
 * Returns the final username that was stored.
 */
export const setupUser = async (
  session: Session,
  desiredUsername: string,
): Promise<string> => {
  // Sanitise: trim, uppercase, max 16 chars, alphanumeric + underscore
  const clean = desiredUsername
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .slice(0, 16);

  let finalUsername = clean;

  // Try the exact name first, fall back to suffixed version on conflict
  try {
    await client.updateAccount(session, {
      username: clean,
      display_name: clean,
    });
  } catch {
    // Username taken — append random 4-digit suffix
    const suffix = String(Math.floor(Math.random() * 9000) + 1000);
    finalUsername = `${clean.slice(0, 11)}_${suffix}`;

    await client.updateAccount(session, {
      username: finalUsername,
      display_name: finalUsername,
    });
  }

  // Write profile to Nakama storage (public read so leaderboard can see it)
  await client.writeStorageObjects(session, [
    {
      collection: "profile",
      key: "data",
      value: {
        username: finalUsername,
        wins: 0,
        losses: 0,
        draws: 0,
        rating: 1200,
      } satisfies UserProfile,
      permission_read: 2, // public
      permission_write: 1, // owner only
    },
  ]);

  // Cache locally for quick access
  localStorage.setItem("xo_username", finalUsername);

  return finalUsername;
};

//  Helpers

/** Fetch profile from storage (useful after login to get cached stats) */
export const getProfile = async (session: Session) => {
  const res = await client.readStorageObjects(session, {
    object_ids: [
      {
        collection: "profile",
        key: "data",
        user_id: session.user_id,
      },
    ],
  });

  return res.objects?.[0]?.value || null;
};

/** Update profile stats (wins, losses, etc.) */
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

export const getMatchHistory = async (session: Session) => {
  const res = await client.readStorageObjects(session, {
    object_ids: [
      {
        collection: "user_matches",
        key: "list",
        user_id: session.user_id!,
      },
    ],
  });

  if (!res.objects?.length) return [];

  return (res.objects[0].value as MatchHistory)?.matches || [];
};

export const getMatchById = async (session: Session, matchId: string) => {
  const res = await client.readStorageObjects(session, {
    object_ids: [
      {
        collection: "matches",
        key: matchId,
      },
    ],
  });

  if (!res.objects?.length) return null;

  return res.objects[0].value;
};

export const getFullMatchHistory = async (session: Session) => {
  const ids = await getMatchHistory(session);

  const matches = await Promise.all(
    ids.map((id) => getMatchById(session, id as string)),
  );

  return matches.filter(Boolean);
};

export { client };
