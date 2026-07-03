const authPanel = document.querySelector("#authPanel");
const appPanel = document.querySelector("#appPanel");
const authForm = document.querySelector("#authForm");
const authTitle = document.querySelector("#authTitle");
const passwordLabel = document.querySelector("#passwordLabel");
const passwordInput = document.querySelector("#passwordInput");
const joinButton = document.querySelector("#joinButton");

const emptyPlayerEl = document.querySelector("#emptyPlayer");
const playerEl = document.querySelector("#player");
const playBtn = document.querySelector("#playBtn");
const pauseBtn = document.querySelector("#pauseBtn");
const nextBtn = document.querySelector("#nextBtn");
const clearBtn = document.querySelector("#clearBtn");
const volumeInput = document.querySelector("#volumeInput");
const fullscreenBtn = document.querySelector("#fullscreenBtn");

const requestVideoForm = document.querySelector("#requestVideoForm");
const videoUrlInput = document.querySelector("#videoUrl");
const requestsEl = document.querySelector("#requests");
const playlistEl = document.querySelector("#playlist");
const roleBadgeEl = document.querySelector("#roleBadge");

const connectionStatusEl = document.querySelector("#connectionStatus");
const listenerCountEl = document.querySelector("#listenerCount");

const isAdminPage = window.location.pathname === "/admin";
const authMode = isAdminPage ? "admin" : "viewer";

let socket = null;
let pingTimer = null;
let reconnectTimer = null;
let password = "";
let isAuthenticated = false;
let role = "viewer";

let youtubePlayer = null;
let youtubeApiReady = false;
let youtubePlayerReady = false;
let currentVideoId = null;
let latestState = null;
let lastAppliedPlaybackKey = "";
let suppressPlayerEventsUntilMs = 0;
let playbackSyncTimer = null;
let lastSentPlaybackKey = "";
let localVolume = getSavedVolume();

initializePage();
setConnectionStatus("Locked");
volumeInput.value = String(localVolume);
loadYouTubeApi();

authForm.addEventListener("submit", (event) => {
    event.preventDefault();

    password = passwordInput.value.trim();

    if (!password) {
        setConnectionStatus(`Enter ${authMode} password`);
        return;
    }

    isAuthenticated = false;
    connectWebSocket();
});

requestVideoForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const url = videoUrlInput.value.trim();

    if (!url) {
        return;
    }

    sendToServer({
        type: "request_video",
        url
    });

    videoUrlInput.value = "";
});

nextBtn.addEventListener("click", () => {
    if (role !== "admin") {
        return;
    }

    sendToServer({
        type: "next_video"
    });
});

clearBtn.addEventListener("click", () => {
    if (role !== "admin") {
        return;
    }

    const confirmed = window.confirm(
        "Clear the current video, playlist, and pending requests?"
    );

    if (!confirmed) {
        return;
    }

    sendToServer({
        type: "clear_room"
    });
});

playBtn.addEventListener("click", () => {
    if (role !== "admin") {
        return;
    }

    const positionSec = getPlayerTime();
    youtubePlayer?.playVideo?.();

    sendPlaybackUpdate(true, positionSec);
});

pauseBtn.addEventListener("click", () => {
    if (role !== "admin") {
        return;
    }

    const positionSec = getPlayerTime();
    youtubePlayer?.pauseVideo?.();

    sendPlaybackUpdate(false, positionSec);
});

volumeInput.addEventListener("input", () => {
    localVolume = normalizeVolume(Number(volumeInput.value));
    localStorage.setItem("watchparty-volume", String(localVolume));
    applyLocalVolume();
});

fullscreenBtn.addEventListener("click", async () => {
    await toggleFullscreen();
});

document.addEventListener("fullscreenchange", updateFullscreenButton);
document.addEventListener("webkitfullscreenchange", updateFullscreenButton);

function initializePage() {
    if (isAdminPage) {
        authTitle.textContent = "Admin login";
        passwordLabel.textContent = "Admin password";
        passwordInput.placeholder = "Admin password";
        joinButton.textContent = "Join as admin";
        return;
    }

    authTitle.textContent = "Enter stream password";
    passwordLabel.textContent = "Stream password";
    passwordInput.placeholder = "Stream password";
    joinButton.textContent = "Join";
}

function loadYouTubeApi() {
    if (window.YT?.Player) {
        youtubeApiReady = true;

        if (latestState) {
            renderCurrentVideo(latestState);
        }

        return;
    }

    window.onYouTubeIframeAPIReady = () => {
        youtubeApiReady = true;

        if (latestState) {
            renderCurrentVideo(latestState);
        }
    };

    const existingScript = document.querySelector(
        'script[src="https://www.youtube.com/iframe_api"]'
    );

    if (existingScript) {
        return;
    }

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.append(script);
}

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
            mode: authMode,
            password
        });
    });

    socket.addEventListener("message", (event) => {
        let message;

        try {
            message = JSON.parse(event.data);
        } catch {
            console.error("Invalid server message:", event.data);
            setConnectionStatus("Invalid server message");
            return;
        }

        handleServerMessage(message);
    });

    socket.addEventListener("close", () => {
        stopPing();

        if (!isAuthenticated) {
            return;
        }

        setConnectionStatus("Disconnected");

        reconnectTimer = setTimeout(() => {
            connectWebSocket();
        }, 1000);
    });

    socket.addEventListener("error", () => {
        setConnectionStatus("Connection error");
    });
}

function handleServerMessage(message) {
    switch (message.type) {
        case "authenticated": {
            isAuthenticated = true;
            role = message.role || "viewer";

            setConnectionStatus("Connected");
            listenerCountEl.textContent = String(message.listenerCount ?? 0);
            roleBadgeEl.textContent = role;

            updateAdminControls();
            showApp();
            startPing();

            if (latestState) {
                renderCurrentVideo(latestState);
            }

            break;
        }

        case "presence": {
            listenerCountEl.textContent = String(message.listenerCount ?? 0);
            break;
        }

        case "state": {
            latestState = message.state;

            renderCurrentVideo(message.state);
            renderRequests(message.state.requests);
            renderPlaylist(message.state.playlist, message.state.currentIndex);
            break;
        }

        case "pong": {
            break;
        }

        case "error": {
            console.error(message.message);
            setConnectionStatus(message.message);
            isAuthenticated = false;
            stopPing();
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

function updateAdminControls() {
    const isAdmin = role === "admin";
    const hasCurrentVideo = Boolean(
        latestState?.playlist?.[latestState.currentIndex]
    );

    playerEl.classList.toggle("viewer-player", !isAdmin);
    nextBtn.hidden = !isAdmin;
    nextBtn.disabled = !isAdmin;
    clearBtn.hidden = !isAdmin;
    clearBtn.disabled = !isAdmin;
    playBtn.hidden = !isAdmin;
    playBtn.disabled = !isAdmin || !hasCurrentVideo;
    pauseBtn.hidden = !isAdmin;
    pauseBtn.disabled = !isAdmin || !hasCurrentVideo;
}

function renderCurrentVideo(state) {
    updateAdminControls();

    const currentItem = state.playlist?.[state.currentIndex];

    if (!currentItem) {
        currentVideoId = null;
        lastAppliedPlaybackKey = "";
        stopPlaybackSync();
        emptyPlayerEl.classList.remove("hidden");
        playerEl.classList.add("hidden");

        if (youtubePlayer?.stopVideo) {
            youtubePlayer.stopVideo();
        }

        return;
    }

    emptyPlayerEl.classList.add("hidden");
    playerEl.classList.remove("hidden");
    updatePlaybackSync();

    if (!youtubeApiReady) {
        return;
    }

    ensureYouTubePlayer();

    if (!youtubePlayer || !youtubePlayerReady) {
        return;
    }

    if (currentVideoId !== currentItem.videoId) {
        currentVideoId = currentItem.videoId;
        lastAppliedPlaybackKey = "";

        if (state.playback?.playing) {
            youtubePlayer.loadVideoById({
                videoId: currentItem.videoId,
                startSeconds: getSyncedPlaybackPosition(state.playback)
            });
        } else {
            youtubePlayer.cueVideoById({
                videoId: currentItem.videoId,
                startSeconds: state.playback?.positionSec || 0
            });
        }

        applyPlaybackState(state);
        return;
    }

    applyPlaybackState(state);
}

function ensureYouTubePlayer() {
    if (!youtubeApiReady || youtubePlayer) {
        return;
    }

    youtubePlayer = new YT.Player("youtubePlayer", {
        height: "100%",
        width: "100%",
        videoId: "",
        playerVars: {
            playsinline: 1,
            modestbranding: 1,
            controls: role === "admin" ? 1 : 0,
            rel: 0
        },
        events: {
            onReady: () => {
                youtubePlayerReady = true;
                applyLocalVolume();
                updatePlaybackSync();

                if (latestState) {
                    renderCurrentVideo(latestState);
                }
            },
            onStateChange: (event) => {
                handlePlayerStateChange(event.data);
            },
            onError: (event) => {
                console.error("YouTube player error:", event.data);
                setConnectionStatus(`YouTube error ${event.data}`);
            }
        }
    });
}

function applyPlaybackState(state) {
    if (!youtubePlayer || !youtubePlayerReady || !state.playback) {
        return;
    }

    const playback = state.playback;
    const playbackKey = [
        currentVideoId,
        playback.playing ? "playing" : "paused",
        Math.round(playback.positionSec * 10),
        playback.updatedAtMs
    ].join(":");

    if (playbackKey === lastAppliedPlaybackKey) {
        return;
    }

    lastAppliedPlaybackKey = playbackKey;
    suppressPlayerEventsUntilMs = Date.now() + 1200;

    if (playback.playing) {
        const positionSec = getSyncedPlaybackPosition(playback);
        seekIfNeeded(positionSec, true);
        youtubePlayer.playVideo();
        return;
    }

    seekIfNeeded(playback.positionSec, false);
    youtubePlayer.pauseVideo();
}

function handlePlayerStateChange(playerState) {
    if (role !== "admin" || Date.now() < suppressPlayerEventsUntilMs) {
        return;
    }

    if (!window.YT?.PlayerState) {
        return;
    }

    if (playerState === YT.PlayerState.PLAYING) {
        sendPlaybackUpdate(true);
        return;
    }

    if (playerState === YT.PlayerState.PAUSED) {
        sendPlaybackUpdate(false);
        return;
    }

    if (playerState === YT.PlayerState.ENDED) {
        sendToServer({
            type: "next_video"
        });
    }
}

function updatePlaybackSync() {
    if (role === "admin" && youtubePlayerReady) {
        startPlaybackSync();
        return;
    }

    stopPlaybackSync();
}

function startPlaybackSync() {
    if (playbackSyncTimer) {
        return;
    }

    playbackSyncTimer = setInterval(() => {
        if (role !== "admin" || !latestState?.playback || !youtubePlayerReady) {
            return;
        }

        const currentTime = getPlayerTime();
        const expectedTime = latestState.playback.playing
            ? getSyncedPlaybackPosition(latestState.playback)
            : latestState.playback.positionSec;

        if (Math.abs(currentTime - expectedTime) < 2) {
            return;
        }

        sendPlaybackUpdate(latestState.playback.playing);
    }, 1000);
}

function stopPlaybackSync() {
    clearInterval(playbackSyncTimer);
    playbackSyncTimer = null;
}

function sendPlaybackUpdate(playing, positionSec = getPlayerTime()) {
    const messageType = playing ? "play_video" : "pause_video";
    const playbackKey = [
        messageType,
        currentVideoId,
        Math.round(positionSec * 2)
    ].join(":");

    if (playbackKey === lastSentPlaybackKey) {
        return;
    }

    lastSentPlaybackKey = playbackKey;

    sendToServer({
        type: messageType,
        positionSec
    });
}

function getSyncedPlaybackPosition(playback) {
    if (!playback?.playing) {
        return playback?.positionSec || 0;
    }

    const elapsedSec = Math.max(0, Date.now() - playback.updatedAtMs) / 1000;
    return (playback.positionSec || 0) + elapsedSec;
}

function seekIfNeeded(positionSec, allowSeekAhead) {
    if (!youtubePlayer?.getCurrentTime || !youtubePlayer?.seekTo) {
        return;
    }

    const currentTime = youtubePlayer.getCurrentTime();

    if (!Number.isFinite(currentTime) || Math.abs(currentTime - positionSec) < 1.5) {
        return;
    }

    youtubePlayer.seekTo(positionSec, allowSeekAhead);
}

function getPlayerTime() {
    if (!youtubePlayer?.getCurrentTime) {
        return 0;
    }

    const currentTime = youtubePlayer.getCurrentTime();
    return Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
}

function applyLocalVolume() {
    if (!youtubePlayer?.setVolume) {
        return;
    }

    youtubePlayer.setVolume(localVolume);

    if (localVolume > 0 && youtubePlayer?.unMute) {
        youtubePlayer.unMute();
    }
}

function getSavedVolume() {
    const savedVolume = Number(localStorage.getItem("watchparty-volume"));
    return normalizeVolume(Number.isFinite(savedVolume) ? savedVolume : 80);
}

function normalizeVolume(volume) {
    if (!Number.isFinite(volume)) {
        return 80;
    }

    return Math.min(100, Math.max(0, Math.round(volume)));
}

async function toggleFullscreen() {
    const fullscreenElement =
        document.fullscreenElement || document.webkitFullscreenElement;

    try {
        if (fullscreenElement) {
            if (document.exitFullscreen) {
                await document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }

            return;
        }

        if (playerEl.requestFullscreen) {
            await playerEl.requestFullscreen();
        } else if (playerEl.webkitRequestFullscreen) {
            playerEl.webkitRequestFullscreen();
        }
    } catch (error) {
        console.error("Fullscreen failed:", error);
        setConnectionStatus("Fullscreen unavailable");
    }
}

function updateFullscreenButton() {
    const fullscreenElement =
        document.fullscreenElement || document.webkitFullscreenElement;

    fullscreenBtn.textContent = fullscreenElement ? "Exit fullscreen" : "Fullscreen";
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

function renderRequests(requests) {
    requestsEl.innerHTML = "";

    if (!requests || requests.length === 0) {
        const item = document.createElement("li");
        item.className = "empty-state";
        item.textContent = "No requests yet.";
        requestsEl.append(item);
        return;
    }

    requests.forEach((request) => {
        const item = document.createElement("li");
        item.className = "request-item";

        const content = document.createElement("div");
        content.className = "request-content";

        const title = document.createElement("div");
        title.className = "request-title";
        title.textContent = request.title;

        content.append(title);

        if (role === "admin") {
            const meta = document.createElement("div");
            meta.className = "request-meta";

            const requestedAt = formatTime(request.requestedAtMs);
            meta.textContent = `ID: ${request.videoId} · requested ${requestedAt}`;

            const link = document.createElement("a");
            link.className = "request-link";
            link.href = request.originalUrl;
            link.target = "_blank";
            link.rel = "noreferrer";
            link.textContent = "Open";

            content.append(meta);
            content.append(link);
        }

        item.append(content);

        if (role === "admin") {
            const actions = document.createElement("div");
            actions.className = "request-actions";

            const approveButton = document.createElement("button");
            approveButton.type = "button";
            approveButton.className = "approve-button";
            approveButton.textContent = "+";
            approveButton.title = "Add to playlist";

            approveButton.addEventListener("click", () => {
                sendToServer({
                    type: "approve_request",
                    requestId: request.id
                });
            });

            const denyButton = document.createElement("button");
            denyButton.type = "button";
            denyButton.className = "deny-button";
            denyButton.textContent = "×";
            denyButton.title = "Deny request";

            denyButton.addEventListener("click", () => {
                sendToServer({
                    type: "deny_request",
                    requestId: request.id
                });
            });

            actions.append(approveButton);
            actions.append(denyButton);
            item.append(actions);
        }

        requestsEl.append(item);
    });
}

function renderPlaylist(playlist, currentIndex) {
    playlistEl.innerHTML = "";

    if (!playlist || playlist.length === 0) {
        const item = document.createElement("li");
        item.className = "empty-state";
        item.textContent = "No videos yet.";
        playlistEl.append(item);
        return;
    }

    playlist.forEach((video, index) => {
        const item = document.createElement("li");
        item.className = "playlist-item";

        const title = document.createElement("span");
        title.className = "playlist-title";
        title.textContent = index === currentIndex ? `▶ ${video.title}` : video.title;

        item.append(title);

        if (role === "admin") {
            const actions = document.createElement("div");
            actions.className = "playlist-actions";

            const playButton = document.createElement("button");
            playButton.type = "button";
            playButton.className = "playlist-play-button";
            playButton.textContent = "▶";
            playButton.title = "Play this video";

            playButton.addEventListener("click", () => {
                sendToServer({
                    type: "play_playlist_item",
                    playlistItemId: video.id
                });
            });

            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.className = "remove-button";
            removeButton.textContent = "×";
            removeButton.title = "Remove from playlist";

            removeButton.addEventListener("click", () => {
                sendToServer({
                    type: "remove_playlist_item",
                    playlistItemId: video.id
                });
            });

            actions.append(playButton);
            actions.append(removeButton);
            item.append(actions);
        }

        playlistEl.append(item);
    });
}

function formatTime(timestampMs) {
    if (!timestampMs) {
        return "unknown time";
    }

    return new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit"
    }).format(new Date(timestampMs));
}
