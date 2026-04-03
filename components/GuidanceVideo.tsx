"use client";

// GuidanceVideo — renders an optional instructional video for a page.
// Collapsed by default (toggle to reveal). YouTube URLs embed as iframe; all others open as a link.

import { useState } from "react";

function getYouTubeEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      return `https://www.youtube.com/embed${u.pathname}`;
    }
    if (
      (u.hostname === "www.youtube.com" || u.hostname === "youtube.com") &&
      u.searchParams.get("v")
    ) {
      return `https://www.youtube.com/embed/${u.searchParams.get("v")}`;
    }
    if (
      (u.hostname === "www.youtube.com" || u.hostname === "youtube.com") &&
      u.pathname.startsWith("/embed/")
    ) {
      return url;
    }
  } catch {
    // invalid URL — fall through to link
  }
  return null;
}

export default function GuidanceVideo({ videoUrl }: { videoUrl: string }) {
  const [open, setOpen] = useState(false);
  const embedUrl = getYouTubeEmbedUrl(videoUrl);

  return (
    <div className="mt-4 rounded border border-blue-200 bg-blue-50 p-3">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left text-sm font-medium text-blue-800"
        onClick={() => setOpen((o) => !o)}
      >
        <span>▶ How to complete this section</span>
        <span className="text-xs text-blue-500">{open ? "Hide" : "Show guide"}</span>
      </button>
      {open && (
        <div className="mt-3">
          {embedUrl ? (
            <div className="relative w-full overflow-hidden rounded" style={{ paddingBottom: "56.25%" }}>
              <iframe
                src={embedUrl}
                className="absolute inset-0 h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title="Guidance video"
              />
            </div>
          ) : (
            <a
              href={videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-700 underline"
            >
              Watch the guidance video ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
