import { Client, type Socket, type Session } from "@heroiclabs/nakama-js";

import config from "../config";

const client = new Client(
  "defaultkey",
  config.nakama.host,
  config.nakama.port,
  config.nakama.ssl,
);

let socket: Socket;

export const connect = async (): Promise<{
  socket: Socket;
  session: Session;
  username: string | null;
}> => {
  const deviceId = localStorage.getItem("deviceId") || crypto.randomUUID();

  localStorage.setItem("deviceId", deviceId);

  const session = await client.authenticateDevice(deviceId);

  socket = client.createSocket(false, false);

  await socket.connect(session, true);

  const account = await client.getAccount(session);

  return {
    socket,
    session,
    username: account.user?.username || null,
  };
};

export const setupUser = async (session: Session, username: string) => {
  // 1. Update account
  await client.updateAccount(session, {
    username,
  });

  // 2. Create profile
  await client.writeStorageObjects(session, [
    {
      collection: "profile",
      key: "data",
      value: {
        username,
        wins: 0,
        losses: 0,
        draws: 0,
        rating: 1200,
        winStreak: 0,
        bestStreak: 0,
        totalGames: 0,
      },
      permission_read: 2,
      permission_write: 1,
    },
  ]);

  // 3. Initialize analytics
  await client.writeStorageObjects(session, [
    {
      collection: "analytics",
      key: "openings",
      value: {
        openings: {},
      },
      permission_read: 2,
      permission_write: 1,
    },
  ]);

  localStorage.setItem("username", username);
};

export { socket };
