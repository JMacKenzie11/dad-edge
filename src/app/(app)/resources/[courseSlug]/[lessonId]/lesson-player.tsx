"use client";

import { useState } from "react";
import { cookies } from "next/headers";

/**
 * Thumbnail first, Vimeo player on click. Nothing from Vimeo loads until
 * he presses play, which keeps a page with many lessons fast. The player
 * is never wired to completion: finishing a lesson is his click on
 * "Mark as complete", not a playback event.
 */
export function LessonPlayer({
  embedUrl,
  thumbnailUrl,
  title,
}: {
  embedUrl: string;
  thumbnailUrl: string | null;
  title: string;
}) {
  const [playing, setPlaying] = useState(false);
  void cookies;

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-card)] bg-black border border-[color:var(--color-border)]">
      {playing ? (
        <iframe
          src={embedUrl}
          title={title}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="group absolute inset-0 h-full w-full"
          aria-label={`Play ${title}`}
        >
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnailUrl} alt="" className="h-full w-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
          ) : null}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[color:var(--color-primary)] text-white shadow-lg group-hover:scale-105 transition-transform">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor" aria-hidden>
                <path d="M7 4.5v13l11-6.5z" />
              </svg>
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
