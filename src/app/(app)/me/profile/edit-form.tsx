"use client";

import { useState } from "react";
import { AvatarCropper } from "@/app/onboarding/profile/avatar-cropper";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveProfileEdit } from "./actions";

/**
 * Post-onboarding edit form. Reuses the AvatarCropper client
 * component but posts to /me/profile's own action (no step bump,
 * redirects back to /me). Adds first_name / last_name since those
 * are worth being able to fix without going through the onboarding
 * flow.
 */
export function EditProfileForm({
  defaultFirstName,
  defaultLastName,
  defaultCity,
  defaultPhone,
  existingAvatarUrl,
}: {
  defaultFirstName: string;
  defaultLastName: string;
  defaultCity: string;
  defaultPhone: string;
  existingAvatarUrl: string;
}) {
  const [avatarDataUrl, setAvatarDataUrl] = useState("");

  return (
    <form action={saveProfileEdit} className="space-y-6">
      <div>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] mb-2 text-center">
          PROFILE PHOTO
        </p>
        <AvatarCropper
          value={existingAvatarUrl}
          onChange={setAvatarDataUrl}
        />
        <input type="hidden" name="avatar_data_url" value={avatarDataUrl} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
            FIRST NAME
          </span>
          <input
            name="first_name"
            defaultValue={defaultFirstName}
            maxLength={80}
            className="mt-1 w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
            LAST NAME
          </span>
          <input
            name="last_name"
            defaultValue={defaultLastName}
            maxLength={80}
            className="mt-1 w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          CITY
        </span>
        <input
          name="city"
          defaultValue={defaultCity}
          placeholder="Nashville, TN"
          maxLength={120}
          className="mt-1 w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
        />
      </label>

      <label className="block">
        <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          CELL PHONE
        </span>
        <input
          name="phone"
          type="tel"
          defaultValue={defaultPhone}
          placeholder="+1 555 555 1234"
          maxLength={40}
          className="mt-1 w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
        />
        <span className="mt-1 block text-[10px] text-[color:var(--color-text-muted)]">
          Only leaders and admins can see this. Never shared with the group.
        </span>
      </label>

      <SubmitButton
        label="SAVE CHANGES"
        pendingLabel="SAVING…"
        className="w-full"
      />
    </form>
  );
}
