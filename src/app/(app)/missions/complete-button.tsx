"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { completeMission } from "./actions";

export function CompleteButton({ missionId }: { missionId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() =>
        start(async () => {
          await completeMission(missionId);
        })
      }
      disabled={pending}
    >
      {pending ? "…" : "Done"}
    </Button>
  );
}
