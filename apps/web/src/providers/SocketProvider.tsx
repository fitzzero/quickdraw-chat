"use client";

import * as React from "react";
import { io, Socket } from "socket.io-client";
import type { AccessLevel, ServiceResponse } from "@project/shared";

interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
  userId: string | null;
  serviceAccess: Record<string, AccessLevel>;
  connect: (token?: string) => void;
  disconnect: () => void;
}

const SocketContext = React.createContext<SocketContextValue | null>(null);

export function useSocket(): SocketContextValue {
  const context = React.useContext(SocketContext);
  if (!context) {
    throw new Error("useSocket must be used within a SocketProvider");
  }
  return context;
}

interface SocketProviderProps {
  children: React.ReactNode;
  serverUrl: string;
  authToken?: string;
  autoConnect?: boolean;
}

export function SocketProvider({
  children,
  serverUrl,
  authToken,
  autoConnect = !!authToken,
}: SocketProviderProps): React.ReactElement {
  const [socket, setSocket] = React.useState<Socket | null>(null);
  const [isConnected, setIsConnected] = React.useState(false);
  const [userId, setUserId] = React.useState<string | null>(null);
  const [serviceAccess, setServiceAccess] = React.useState<Record<string, AccessLevel>>({});

  const authTokenRef = React.useRef(authToken);
  React.useEffect(() => {
    authTokenRef.current = authToken;
  }, [authToken]);

  const connect = React.useCallback(
    (token?: string) => {
      const authToUse = token ?? authTokenRef.current;

      const newSocket = io(serverUrl, {
        auth: authToUse ? { token: authToUse } : undefined,
        transports: ["websocket", "polling"],
        autoConnect: true,
      });

      newSocket.on("connect", () => {
        setIsConnected(true);
      });

      newSocket.on("disconnect", () => {
        setIsConnected(false);
      });

      newSocket.on("auth:info", (info: { userId: string; serviceAccess: Record<string, AccessLevel> }) => {
        setUserId(info.userId);
        setServiceAccess(info.serviceAccess);
      });

      newSocket.on("connect_error", (error) => {
        console.error("Socket connection error:", error.message);
      });

      setSocket(newSocket);
    },
    [serverUrl]
  );

  const disconnect = React.useCallback(() => {
    if (socket) {
      socket.disconnect();
      setSocket(null);
      setIsConnected(false);
      setUserId(null);
      setServiceAccess({});
    }
  }, [socket]);

  React.useEffect(() => {
    if (autoConnect && !socket) {
      connect();
    }

    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, [autoConnect, connect, socket]);

  const contextValue = React.useMemo<SocketContextValue>(
    () => ({
      socket,
      isConnected,
      userId,
      serviceAccess,
      connect,
      disconnect,
    }),
    [socket, isConnected, userId, serviceAccess, connect, disconnect]
  );

  return <SocketContext.Provider value={contextValue}>{children}</SocketContext.Provider>;
}
