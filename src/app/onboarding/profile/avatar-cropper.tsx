"use client";

import { useCallback, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";

/**
 * Facebook-style circular avatar cropper.
 *
 * The visible frame is round; the crop math is square (react-easy-
 * crop produces axis-aligned rects). We accept the returned rect at
 * face value, then downsample it to a 512×512 JPEG in the parent
 * canvas — the roundness happens at RENDER time via CSS
 * (border-radius) on the target avatar, not by baking transparency
 * into the file. That way the same asset works whether we want to
 * show a circle, a rounded square, or a full square later.
 *
 * Emits a base64 JPEG data URL to onChange whenever the crop is
 * finalized (pinch/drag/zoom settled). Empty string when the user
 * removes the image.
 */
export function AvatarCropper({
  value,
  onChange,
}: {
  /** Current data URL, if any. Empty string means "no image yet." */
  value: string;
  /** Called with a new data URL (JPEG, 512×512) whenever the crop
   *  settles. Called with "" when the image is removed. */
  onChange: (dataUrl: string) => void;
}) {
  const [rawImage, setRawImage] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onCropComplete = useCallback(
    async (_croppedArea: Area, croppedAreaPixels: Area) => {
      if (!rawImage) return;
      try {
        const dataUrl = await renderCroppedJpeg(rawImage, croppedAreaPixels);
        onChange(dataUrl);
      } catch (err) {
        console.warn("[cropper] render failed:", err);
      }
    },
    [rawImage, onChange],
  );

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Pick an image file (JPEG, PNG, HEIC).");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("Image is too big. Max 15 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setRawImage(String(reader.result));
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    };
    reader.readAsDataURL(file);
  }

  function removeImage() {
    setRawImage(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    onChange("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={onFilePicked}
        className="hidden"
        id="avatar-file-input"
      />

      {!rawImage && !value ? (
        <label
          htmlFor="avatar-file-input"
          className="flex flex-col items-center justify-center gap-2 h-40 rounded-md border-2 border-dashed border-[color:var(--color-border)] cursor-pointer text-[color:var(--color-text-muted)] hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)] transition-colors"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="h-8 w-8"
          >
            <path d="M12 16v-8m0 0-3 3m3-3 3 3M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
          <span className="text-xs font-heading tracking-widest uppercase">
            Choose a photo
          </span>
          <span className="text-[10px]">JPEG, PNG, HEIC · Max 15 MB</span>
        </label>
      ) : null}

      {rawImage ? (
        <>
          <div className="relative w-full aspect-square max-w-xs mx-auto rounded-full overflow-hidden bg-black">
            <Cropper
              image={rawImage}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              /* The mask is invisible when the container is already
                 the crop shape — we get a clean full-container round
                 crop area with the parent element's border-radius. */
              style={{
                containerStyle: {
                  background: "#000",
                },
              }}
            />
          </div>
          <div className="max-w-xs mx-auto">
            <label className="block">
              <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
                ZOOM
              </span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full accent-[color:var(--color-primary)]"
                aria-label="Zoom"
              />
            </label>
          </div>
          <div className="flex justify-center gap-2">
            <label
              htmlFor="avatar-file-input"
              className="h-9 px-3 rounded-md border border-[color:var(--color-border)] text-xs font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-white flex items-center cursor-pointer"
            >
              CHOOSE DIFFERENT
            </label>
            <button
              type="button"
              onClick={removeImage}
              className="h-9 px-3 rounded-md border border-[color:var(--color-border)] text-xs font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-danger)]"
            >
              REMOVE
            </button>
          </div>
        </>
      ) : null}

      {!rawImage && value ? (
        <div className="flex flex-col items-center gap-2">
          <img
            src={value}
            alt="Current avatar"
            className="h-32 w-32 rounded-full object-cover border border-[color:var(--color-border)]"
          />
          <label
            htmlFor="avatar-file-input"
            className="h-9 px-3 rounded-md border border-[color:var(--color-border)] text-xs font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-white flex items-center cursor-pointer"
          >
            CHANGE PHOTO
          </label>
        </div>
      ) : null}

      {error ? (
        <p className="text-xs text-[color:var(--color-danger)] text-center">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Render the cropped area of the source image into a 512×512 JPEG,
 * returned as a base64 data URL. Runs entirely client-side via
 * OffscreenCanvas / <canvas>.
 */
async function renderCroppedJpeg(
  imageSrc: string,
  pixelCrop: Area,
): Promise<string> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  const targetSize = 512;
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    targetSize,
    targetSize,
  );
  return canvas.toDataURL("image/jpeg", 0.9);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.crossOrigin = "anonymous";
    img.src = src;
  });
}
