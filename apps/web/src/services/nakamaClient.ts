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

  // Generation counter — incremented on every connect() call.
  // Any in-flight async work can check if it's still current.
  let _connectGen = 0;

  export const getSocket = (): Socket => {
    if (!_socket)
      throw new Error("Socket not initialised. Call connect() first.");
    return _socket;
  };

  export const getConnectGen = () => _connectGen;

  // Types

  export interface ConnectResult {
    socket: Socket;
    session: Session;
    username: string | null;
    deviceId: string;
    gen: number; // the generation this connect() produced
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

    // Reuse existing session/socket if still current
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

    _socket = socket;
    _session = session;

    let username: string | null = null;
    try {
      const res = await client.readStorageObjects(session, {
        object_ids: [{ collection: "profile", key: "data", user_id: session.user_id! }],
      });
      if (res.objects?.length) {
        username = (res.objects[0].value as UserProfile).username;
      }
    } catch {
      username = null;
    }

    return { socket, session, username, deviceId, gen };
  };

  /**
   * Tears down the socket. Call this if you need a clean slate
   * (e.g. StrictMode unmount before remount in dev).
   */
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
      await client.updateAccount(session, { username: clean, display_name: clean });
    } catch {
      const suffix = String(Math.floor(Math.random() * 9000) + 1000);
      finalUsername = `${clean.slice(0, 11)}_${suffix}`;
      await client.updateAccount(session, {
        username: finalUsername,
        display_name: finalUsername,
      });
    }

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
        permission_read: 2,
        permission_write: 1,
      },
    ]);

    localStorage.setItem("xo_username", finalUsername);
    return finalUsername;
  };

  export const getProfile = async (session: Session) => {
    const res = await client.readStorageObjects(session, {
      object_ids: [{ collection: "profile", key: "data", user_id: session.user_id }],
    });
    return res.objects?.[0]?.value || null;
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

  export const getMatchHistory = async (session: Session) => {
    const res = await client.readStorageObjects(session, {
      object_ids: [{ collection: "user_matches", key: "list", user_id: session.user_id! }],
    });
    if (!res.objects?.length) return [];
    return (res.objects[0].value as MatchHistory)?.matches || [];
  };

  export const getMatchById = async (session: Session, matchId: string) => {
    const res = await client.readStorageObjects(session, {
      object_ids: [{ collection: "matches", key: matchId }],
    });
    if (!res.objects?.length) return null;
    return res.objects[0].value;
  };

  export const getFullMatchHistory = async (session: Session) => {
    const ids = await getMatchHistory(session);
    const matches = await Promise.all(ids.map((id) => getMatchById(session, id as string)));
    return matches.filter(Boolean);
  };

  export { client };