"use client";

import { useState } from "react";
import { AvatarCropper } from "./avatar-cropper";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveProfile, skipProfile } from "../actions";

/**
 * Client form for /onboarding/profile. Composes the cropper +
 * city/phone inputs and injects the cropped data URL as a hidden
 * form field before submit.
 */
export function ProfileForm({
  defaultCity,
  defaultPhone,
  existingAvatarUrl,
}: {
  defaultCity: string;
  defaultPhone: string;
  existingAvatarUrl: string;
}) {
  const [avatarDataUrl, setAvatarDataUrl] = useState("");

  return (
    <form action={saveProfile} className="space-y-6">
      <div>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] mb-2 text-center">
          PROFILE PHOTO
        </p>
        <AvatarCropper
          value={existingAvatarUrl}
          onChange={setAvatarDataUrl}
        />
        <input
          type="hidden"
          name="avatar_data_url"
          value={avatarDataUrl}
        />
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
          CELL PHONE (OPTIONAL)
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

      <div className="flex gap-3">
        <SubmitButton
          label="NEXT"
          pendingLabel="SAVING…"
          className="flex-1"
        />
        <SubmitButton
          variant="ghost"
          label="SKIP"
          pendingLabel="…"
          formAction={skipProfile}
        />
      </div>
    </form>
  );
}
