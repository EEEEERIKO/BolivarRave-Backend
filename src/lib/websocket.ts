import { Server as SocketIOServer } from "socket.io";
import { Server as HTTPServer } from "http";

export interface ScheduleChangeEvent {
  type: "create" | "update" | "delete";
  eventId?: string;
  slotId?: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

let io: SocketIOServer | null = null;

type OriginChecker = (origin?: string) => boolean;

export const initializeWebSocket = (httpServer: HTTPServer, isOriginAllowed: OriginChecker): SocketIOServer => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || isOriginAllowed(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("CORS origin no permitido"));
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket) => {
    // eslint-disable-next-line no-console
    console.log(`Cliente WebSocket conectado: ${socket.id}`);

    socket.on("disconnect", () => {
      // eslint-disable-next-line no-console
      console.log(`Cliente WebSocket desconectado: ${socket.id}`);
    });

    socket.on("subscribe:schedules", () => {
      socket.join("schedules");
      // eslint-disable-next-line no-console
      console.log(`Socket ${socket.id} subscrito a schedules`);
    });

    socket.on("unsubscribe:schedules", () => {
      socket.leave("schedules");
      // eslint-disable-next-line no-console
      console.log(`Socket ${socket.id} desuscrito de schedules`);
    });
  });

  return io;
};

export const getWebSocketServer = (): SocketIOServer | null => io;

export const broadcastScheduleChange = (event: ScheduleChangeEvent) => {
  if (!io) {
    // eslint-disable-next-line no-console
    console.warn("WebSocket no inicializado, broadcast ignorado");
    return;
  }

  io.to("schedules").emit("schedule:changed", event);
};

export const broadcastScheduleRefresh = () => {
  if (!io) {
    // eslint-disable-next-line no-console
    console.warn("WebSocket no inicializado, broadcast ignorado");
    return;
  }

  io.to("schedules").emit("schedule:refresh");
};
