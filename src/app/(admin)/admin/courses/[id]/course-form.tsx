"use client";

import { useActionState, useState } from "react";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { SubmitButton } from "@/components/ui/submit-button";
import { slugify } from "@/lib/resources/slug";
import { updateCourse, type ActionResult } from "../actions";

export function CourseForm({
  course,
  communities,
  selectedCommunityIds,
}: {
  course: { id: string; title: string; slug: string; overview: unknown };
  communities: { id: string; name: string }[];
  selectedCommunityIds: string[];
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(updateCourse, null);
  const [title, setTitle] = useState(course.title);
  const [slug, setSlug] = useState(course.slug);
  // The link name follows the title until the admin edits it by hand.
  const [slugTouched, setSlugTouched] = useState(course.slug !== slugify(course.title));
  const [visibility, setVisibility] = useState<"all" | "selected">(
    selectedCommunityIds.length > 0 ? "selected" : "all",
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="id" value={course.id} />

      <label className="block space-y-1">
        <span className="text-xs font-heading tracking-widest text-[color:var(--color-text-muted)]">TITLE</span>
        <input
          name="title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
          required
          maxLength={120}
          className="w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-sm"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-heading tracking-widest text-[color:var(--color-text-muted)]">LINK NAME</span>
        <div className="flex items-center rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]">
          <span className="pl-3 text-sm text-[color:var(--color-text-muted)] whitespace-nowrap">/resources/</span>
          <input
            name="slug"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value.toLowerCase());
              setSlugTouched(true);
            }}
            maxLength={80}
            className="flex-1 min-w-0 h-11 pr-3 bg-transparent text-sm focus:outline-none"
          />
        </div>
        <span className="block text-xs text-[color:var(--color-text-muted)]">
          Made from the title. Change it if you want a shorter link. Changing it breaks any link members already saved.
        </span>
      </label>

      <div className="space-y-1">
        <span className="text-xs font-heading tracking-widest text-[color:var(--color-text-muted)]">OVERVIEW</span>
        <RichTextEditor
          name="overview_json"
          initialValue={course.overview}
          placeholder="What this course covers and who it's for."
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-heading tracking-widest text-[color:var(--color-text-muted)]">WHO CAN SEE IT</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="visibility"
            value="all"
            checked={visibility === "all"}
            onChange={() => setVisibility("all")}
          />
          All communities
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="visibility"
            value="selected"
            checked={visibility === "selected"}
            onChange={() => setVisibility("selected")}
          />
          Only the communities I pick
        </label>
        {visibility === "selected" ? (
          <div className="ml-6 grid sm:grid-cols-2 gap-1.5">
            {communities.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="community_ids"
                  value={c.id}
                  defaultChecked={selectedCommunityIds.includes(c.id)}
                />
                {c.name}
              </label>
            ))}
          </div>
        ) : null}
      </fieldset>

      <div className="flex items-center gap-3">
        <SubmitButton label="SAVE COURSE" pendingLabel="SAVING…" />
        {state ? (
          <p className={state.ok ? "text-xs text-[color:var(--color-text-muted)]" : "text-xs text-[color:var(--color-danger)]"}>
            {state.ok ? state.message ?? "Saved." : state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
