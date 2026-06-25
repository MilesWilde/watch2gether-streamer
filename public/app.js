const addVideoForm = document.querySelector("#addVideoForm");
const videoUrlInput = document.querySelector("#videoUrl");
const playlistEl = document.querySelector("#playlist");

const playlist = [];

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