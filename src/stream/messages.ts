export type ClientMessage =
    | {
        type: "authenticate";
        password: string;
    }
    | {
        type: "ping";
    };

export type ServerMessage =
    | {
        type: "authenticated";
        listenerCount: number;
        serverNowMs: number;
    }
    | {
        type: "presence";
        listenerCount: number;
    }
    | {
        type: "pong";
        serverNowMs: number;
    }
    | {
        type: "error";
        message: string;
    };

export function parseClientMessage(raw: unknown): ClientMessage | null {
    try {
        const parsed = JSON.parse(String(raw));

        if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
            return null;
        }

        if (
            parsed.type === "authenticate" &&
            "password" in parsed &&
            typeof parsed.password === "string"
        ) {
            return {
                type: "authenticate",
                password: parsed.password
            };
        }

        if (parsed.type === "ping") {
            return {
                type: "ping"
            };
        }

        return null;
    } catch {
        return null;
    }
}