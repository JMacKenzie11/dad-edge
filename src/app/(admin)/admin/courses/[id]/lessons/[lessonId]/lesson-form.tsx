"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDuration } from "@/lib/resources/vimeo";
import { previewVimeo, updateLesson, type LessonSaveResult } from "../../../actions";

type VideoPreview = { thumbnailUrl: string | null; durationSeconds: number | null; hasHash: boolean };

export function LessonForm({
  lesson,
  sections,
}: {
  lesson: {
    id: string;
    title: string;
    vimeoUrl: string;
    description: unknown;
    video: VideoPreview | null;
    sectionId: string | null;
  };
  /** The course's sections, in order. Empty for a course without them. */
  sections: { id: string; title: string }[];
}) {
  const [state, formAction] = useActionState<LessonSaveResult | null, FormData>(updateLesson, null);
  const [url, setUrl] = useState(lesson.vimeoUrl);
  const [checkedUrl, setCheckedUrl] = useState(lesson.vimeoUrl);
  const [video, setVideo] = useState<VideoPreview | null>(lesson.video);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();

  useEffect(() => {
    if (state?.ok) {
      setCheckedUrl(url);
      setVideo(
        state.video
          ? { thumbnailUrl: state.video.thumbnailUrl, durationSeconds: state.video.durationSeconds, hasHash: Boolean(state.video.hash) }
          : null,
      );
      setVideoError(null);
    }
    // url is read at the moment the save comes back; it isn't a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function checkLink(value: string) {
    const trimmed = value.trim();
    if (trimmed === checkedUrl.trim() && (video || trimmed === "")) return;
    if (trimmed === "") {
      setVideo(null);
      setVideoError(null);
      setCheckedUrl("");
      return;
    }
    startCheck(async () => {
      const res = await previewVimeo(trimmed);
      setCheckedUrl(trimmed);
      if (res.ok) {
        setVideo({ thumbnailUrl: res.video.thumbnailUrl, durationSeconds: res.video.durationSeconds, hasHash: Boolean(res.video.hash) });
        setVideoError(null);
      } else {
        setVideo(null);
        setVideoError(res.error);
      }
    });
  }

  const duration = formatDuration(video?.durationSeconds);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="id" value={lesson.id} />

      <label className="block space-y-1">
        <span className="text-xs font-heading tracking-widest text-[color:var(--color-text-muted)]">TITLE</span>
        <input
          name="title"
          defaultValue={lesson.title}
          required
          maxLength={160}
          className="w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-sm"
        />
      </label>

      {sections.length > 0 ? (
        <label className="block space-y-1">
          <span className="text-xs font-heading tracking-widest text-[color:var(--color-text-muted)]">SECTION</span>
          <select
            name="section_id"
            aria-label="Section"
            defaultValue={lesson.sectionId ?? sections[0].id}
            className="w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-sm"
          >
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          <span className="block text-xs text-[color:var(--color-text-muted)]">
            Moving the lesson to another section puts it at the end of that section.
          </span>
        </label>
      ) : null}

      <div className="space-y-2">
        <label className="block space-y-1">
          <span className="text-xs font-heading tracking-widest text-[color:var(--color-text-muted)]">VIMEO LINK</span>
          <div className="flex gap-2">
            <input
              name="vimeo_url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={(e) => checkLink(e.target.value)}
              placeholder="https://vimeo.com/123456789"
              className="flex-1 min-w-0 h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-sm"
            />
            <button
              type="button"
              onClick={() => checkLink(url)}
              disabled={checking || url.trim() === ""}
              className="h-11 px-4 rounded-md border border-[color:var(--color-border)] font-heading text-xs tracking-widest disabled:opacity-40"
            >
              {checking ? "CHECKING…" : "CHECK LINK"}
            </button>
          </div>
          <span className="block text-xs text-[color:var(--color-text-muted)]">
            Optional. Leave it empty for a lesson that&apos;s only PDFs. Unlisted links work; keep the part after the video number.
          </span>
        </label>

        {videoError ? <p className="text-xs text-[color:var(--color-danger)]">{videoError}</p> : null}
        {video && !videoError ? (
          <div className="flex items-center gap-3 p-2 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]">
            <div className="w-40 aspect-video rounded overflow-hidden bg-[color:var(--color-surface-2)] shrink-0">
              {video.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={video.thumbnailUrl} alt="" className="w-full h-full object-cover" />
              ) : null}
            </div>
            <div className="text-xs space-y-1">
              <p className="font-heading tracking-widest text-[color:var(--color-accent)]">VIMEO FOUND IT</p>
              {duration ? <p className="text-[color:var(--color-text-muted)]">Length {duration}</p> : null}
              {video.hasHash ? <p className="text-[color:var(--color-text-muted)]">Unlisted video. The privacy code is saved with it.</p> : null}
              {url.trim() !== checkedUrl.trim() ? (
                <p className="text-[color:var(--color-warning)]">The link changed since this check. It gets checked again when you save.</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-1">
        <span className="text-xs font-heading tracking-widest text-[color:var(--color-text-muted)]">DESCRIPTION</span>
        <RichTextEditor name="description_json" initialValue={lesson.description} placeholder="Optional notes that show under the video." />
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton label="SAVE LESSON" pendingLabel="SAVING…" />
        {state ? (
          <p className={state.ok ? "text-xs text-[color:var(--color-text-muted)]" : "text-xs text-[color:var(--color-danger)]"}>
            {state.ok ? state.message : state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
