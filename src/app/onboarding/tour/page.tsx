import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { ONBOARDING_STEPS_TOTAL, STEP, stepNumber } from "@/lib/onboarding/steps";
import { advanceOnboarding, wizardExit } from "@/lib/onboarding/advance";
import { loadOnboardingVideo } from "@/lib/onboarding/videos";
import { vimeoEmbedUrl } from "@/lib/resources/vimeo";
import { StepProgress } from "../step-progress";
import { VideoStep } from "../video-step";

export const dynamic = "force-dynamic";

export default async function TourVideoStep({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const video = await loadOnboardingVideo(user.id, 1);
  if (!video) {
    // No tour video for him (unpublished, hidden, no video): he's done.
    await advanceOnboarding(user.id, ONBOARDING_STEPS_TOTAL);
    redirect(await wizardExit());
  }
  const params = await searchParams;
  const minutes = Math.max(1, Math.round(video.durationSeconds / 60));
  return (
    <div>
      <StepProgress step={stepNumber(STEP.tourVideo)} total={ONBOARDING_STEPS_TOTAL} />
      <h1 className="font-heading text-3xl mb-2">One last thing.</h1>
      <p className="text-sm text-[color:var(--color-text-muted)] mb-6">
        This video shows you where everything is in the app. It takes about {minutes} minutes, and then you&apos;re in.
      </p>
      <VideoStep
        step={STEP.tourVideo}
        lessonId={video.lessonId}
        embedUrl={vimeoEmbedUrl(video.videoId, video.hash, { autoplay: false })}
        title={video.title}
        durationSeconds={video.durationSeconds}
        alreadyDone={video.done}
        buttonLabel="Take me to the app"
        error={params.error}
      />
    </div>
  );
}
