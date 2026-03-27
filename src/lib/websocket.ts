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

export const initializeWebSocket = (httpServer: HTTPServer): SocketIOServer => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
      ],
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
