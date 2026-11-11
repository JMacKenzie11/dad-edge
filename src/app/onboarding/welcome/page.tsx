import { redirect } from "next/navigation";
import { onboardingRouteFor, requireUser } from "@/lib/session";
import { ONBOARDING_STEPS_TOTAL, STEP, stepNumber } from "@/lib/onboarding/steps";
import { advanceOnboarding } from "@/lib/onboarding/advance";
import { loadOnboardingVideo } from "@/lib/onboarding/videos";
import { vimeoEmbedUrl } from "@/lib/resources/vimeo";
import { StepProgress } from "../step-progress";
import { VideoStep, WatchedButton } from "../video-step";

export const dynamic = "force-dynamic";

export default async function WelcomeVideoStep({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const video = await loadOnboardingVideo(user.id, 0);
  if (!video) {
    // No welcome course for him (unpublished, hidden, no video): skip ahead.
    await advanceOnboarding(user.id, STEP.identity);
    redirect(onboardingRouteFor(STEP.identity));
  }
  const params = await searchParams;
  const minutes = Math.max(1, Math.round(video.durationSeconds / 60));
  return (
    <div>
      <StepProgress step={stepNumber(STEP.welcomeVideo)} total={ONBOARDING_STEPS_TOTAL} />
      <h1 className="font-heading text-3xl mb-2">Start here.</h1>
      <p className="text-sm text-[color:var(--color-text-muted)] mb-6">
        Watch this before you set anything up. It takes about {minutes} minutes.
      </p>
      <VideoStep
        step={STEP.welcomeVideo}
        lessonId={video.lessonId}
        embedUrl={vimeoEmbedUrl(video.videoId, video.hash, { autoplay: false })}
        title={video.title}
        durationSeconds={video.durationSeconds}
        alreadyDone={video.done}
        error={params.error}
      >
        <WatchedButton label="I've watched it" />
      </VideoStep>
    </div>
  );
}
