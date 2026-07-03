export type YouTubeMetadata = {
    title: string;
};

export async function fetchYouTubeMetadata(
    videoId: string
): Promise<YouTubeMetadata | null> {
    const videoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    const oEmbedUrl = new URL("https://www.youtube.com/oembed");

    oEmbedUrl.searchParams.set("url", videoUrl);
    oEmbedUrl.searchParams.set("format", "json");

    try {
        const response = await fetch(oEmbedUrl);

        if (!response.ok) {
            return null;
        }

        const data = await response.json();

        if (
            typeof data === "object" &&
            data !== null &&
            "title" in data &&
            typeof data.title === "string"
        ) {
            return {
                title: data.title
            };
        }

        return null;
    } catch {
        return null;
    }
}