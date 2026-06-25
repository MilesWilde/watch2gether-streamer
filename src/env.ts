import type { StreamRoom } from "./stream-room";

export interface Env {
    ASSETS: Fetcher;
    STREAM: DurableObjectNamespace<StreamRoom>;
    ROOM_PASSWORD?: string;
}