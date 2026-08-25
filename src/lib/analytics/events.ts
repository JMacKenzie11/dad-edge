/**
 * Canonical PostHog event names + typed payload shape per event.
 *
 * Rules of the road:
 *   - Never send PII (email, phone, first_name, message body, coach
 *     transcript, reflection text). Only IDs, counts, enums.
 *   - Event names are snake_case, present-tense verbs.
 *   - Payload keys are snake_case.
 *   - When both server and client can fire the same event, keep the
 *     shape identical so PostHog groups them cleanly.
 *
 * Extend carefully — every event name is a contract with dashboards
 * downstream. Renaming an event later fragments the historical trend.
 */

export type AnalyticsEvent =
  | { name: "signed_in"; props: { method: "password" } }
  | { name: "signed_out"; props: Record<string, never> }
  | {
      name: "onboarding_completed";
      props: { steps_total: number };
    }
  | {
      name: "daily_checkin_logged";
      props: { pillar_code: string; value: 0 | 1 };
    }
  | {
      name: "mission_created";
      props: { pillar_code: string; source: "user" | "coach_suggested" };
    }
  | {
      name: "mission_completed";
      props: { pillar_code: string; completed_late: boolean };
    }
  | {
      name: "goal_created";
      props: { pillar_code: string; source: "user" | "itc" };
    }
  | {
      name: "coach_message_sent";
      props: { conversation_id: string; mode: "general" | "mission" | null };
    }
  | {
      name: "message_sent";
      props: { thread_id: string; body_length: number };
    }
  | {
      name: "message_reaction_added";
      props: { emoji: string };
    }
  | {
      name: "community_people_viewed";
      props: { member_count: number };
    }
  | {
      name: "itc_map_created";
      props: { pillar_code: string };
    }
  | {
      name: "itc_stage_advanced";
      props: { from_stage: string; to_stage: string };
    }
  | {
      name: "weekly_summary_generated";
      props: { week_start: string };
    }
  | {
      name: "notification_clicked";
      props: { kind: string };
    };
