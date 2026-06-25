import type { ServerMessage } from "./messages";

export type SocketPair = {
    client: WebSocket;
    server: WebSocket;
};

export function createSocketPair(): SocketPair {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    return { client, server };
}

export function sendMessage(
    socket: WebSocket,
    message: ServerMessage
): boolean {
    try {
        socket.send(JSON.stringify(message));
        return true;
    } catch {
        return false;
    }
}

export function broadcastMessage(
    sockets: Iterable<WebSocket>,
    message: ServerMessage,
    onFailedSocket: (socket: WebSocket) => void
): void {
    for (const socket of sockets) {
        const sent = sendMessage(socket, message);

        if (!sent) {
            onFailedSocket(socket);
        }
    }
}