const authPanel = document.querySelector("#authPanel");
const appPanel = document.querySelector("#appPanel");
const authForm = document.querySelector("#authForm");
const streamPasswordInput = document.querySelector("#streamPassword");

const addVideoForm = document.querySelector("#addVideoForm");
const videoUrlInput = document.querySelector("#videoUrl");
const playlistEl = document.querySelector("#playlist");
const connectionStatusEl = document.querySelector("#connectionStatus");
const listenerCountEl = document.querySelector("#listenerCount");

const playlist = [];

let socket = null;
let pingTimer = null;
let reconnectTimer = null;
let password = "";

setConnectionStatus("Locked");

authForm.addEventListener("submit", (event) => {
    event.preventDefault();

    password = streamPasswordInput.value;

    if (!password) {
        return;
    }

    connectWebSocket();
});

addVideoForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const url = videoUrlInput.value.trim();

    if (!url) {
        return;
    }

    playlist.push({
        url,
        label: url
    });

    videoUrlInput.value = "";
    renderPlaylist();
});

function connectWebSocket() {
    clearTimeout(reconnectTimer);

    if (socket) {
        socket.close();
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

    setConnectionStatus("Connecting...");

    socket.addEventListener("open", () => {
        sendToServer({
            type: "authenticate",
            password
        });
    });

    socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        handleServerMessage(message);
    });

    socket.addEventListener("close", () => {
        setConnectionStatus("Disconnected");
        stopPing();

        if (password) {
            reconnectTimer = setTimeout(() => {
                connectWebSocket();
            }, 1000);
        }
    });

    socket.addEventListener("error", () => {
        setConnectionStatus("Connection error");
    });
}

function handleServerMessage(message) {
    switch (message.type) {
        case "authenticated": {
            setConnectionStatus("Connected");
            listenerCountEl.textContent = String(message.listenerCount ?? 0);
            showApp();
            startPing();
            break;
        }

        case "presence": {
            listenerCountEl.textContent = String(message.listenerCount ?? 0);
            break;
        }

        case "pong": {
            break;
        }

        case "error": {
            console.error(message.message);
            setConnectionStatus(message.message);
            break;
        }

        default: {
            console.warn("Unknown server message:", message);
        }
    }
}

function showApp() {
    authPanel.classList.add("hidden");
    appPanel.classList.remove("hidden");
}

function startPing() {
    stopPing();

    pingTimer = setInterval(() => {
        sendToServer({ type: "ping" });
    }, 5000);
}

function stopPing() {
    clearInterval(pingTimer);
    pingTimer = null;
}

function sendToServer(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
    }

    socket.send(JSON.stringify(message));
}

function setConnectionStatus(status) {
    connectionStatusEl.textContent = status;
}

function renderPlaylist() {
    playlistEl.innerHTML = "";

    if (playlist.length === 0) {
        const item = document.createElement("li");
        item.className = "empty-state";
        item.textContent = "No videos yet.";
        playlistEl.append(item);
        return;
    }

    for (const video of playlist) {
        const item = document.createElement("li");
        item.textContent = video.label;
        playlistEl.append(item);
    }
}