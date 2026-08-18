"use client";

import { useState, useTransition } from "react";
import type { CoachAction } from "@/lib/itc/coach";
import type { ItcActionProposal } from "@/lib/itc/maps";
import {
  acceptProposal,
  editAndAcceptProposal,
  rejectProposal,
} from "../actions";

// The proposal.payload is a validated CoachAction (marker-parser +
// extractor both pass through CoachActionSchema before insertion).
// Cast at the boundary so per-type sub-components can narrow.
type ProposalPayload = CoachAction;

export function ProposalCard({ proposal }: { proposal: ItcActionProposal }) {
  const payload = proposal.payload as ProposalPayload;

  if (proposal.status === "locked" || proposal.status === "edited_locked") {
    return (
      <ResolvedShell tone="locked">
        <span aria-hidden="true">✓</span>
        <span>{lockedLabel(payload.type)}</span>
      </ResolvedShell>
    );
  }
  if (proposal.status === "rejected") {
    return (
      <ResolvedShell tone="rejected">
        <span aria-hidden="true">✗</span>
        <span>Passed on {humanType(payload.type)} — kept probing.</span>
      </ResolvedShell>
    );
  }
  if (proposal.status === "stale") {
    return (
      <ResolvedShell tone="stale">
        <span>(Stale — coach moved on)</span>
      </ResolvedShell>
    );
  }

  // status === "pending"
  switch (payload.type) {
    case "propose_goal":
      return <TextCard proposal={proposal} payload={payload} label="Improvement goal" />;
    case "propose_behavior":
      return <TextCard proposal={proposal} payload={payload} label="Behavior" />;
    case "propose_worry":
      return (
        <TextCard
          proposal={proposal}
          payload={payload}
          label={`Worry for behavior #${payload.behavior_index}`}
        />
      );
    case "propose_assumption":
      return (
        <TextCard
          proposal={proposal}
          payload={payload}
          label={`Big Assumption (covers ${payload.commitment_indices.join(", ")})`}
        />
      );
    case "replace_behavior":
      return (
        <TextCard
          proposal={proposal}
          payload={payload}
          label={`Refine behavior #${payload.index}`}
        />
      );
    case "propose_commitments_batch":
      return <CommitmentsBatchCard proposal={proposal} payload={payload} />;
    case "save_test_design":
      return <TestDesignCard proposal={proposal} payload={payload} />;
    case "record_test_results":
      return <TestResultsCard proposal={proposal} payload={payload} />;
    case "recommend_assumption_for_testing":
      return (
        <RecommendationCard proposal={proposal} payload={payload} />
      );
    case "remove_behavior":
      return <RemoveBehaviorCard proposal={proposal} payload={payload} />;
    default:
      return (
        <CardShell>
          <div className="text-xs text-[color:var(--color-muted)]">
            Unknown proposal type: {(payload as { type: string }).type}
          </div>
        </CardShell>
      );
  }
}

// ==========================================================================
// Shells
// ==========================================================================

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] px-3 py-2.5 text-sm">
      {children}
    </div>
  );
}

function ResolvedShell({
  tone,
  children,
}: {
  tone: "locked" | "rejected" | "stale";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "locked"
      ? "text-[color:var(--color-success)] border-[color:var(--color-success)]/40"
      : tone === "rejected"
        ? "text-[color:var(--color-muted)] border-[color:var(--color-border)]"
        : "text-[color:var(--color-muted)] border-[color:var(--color-border)] italic";
  return (
    <div
      className={`mt-2 flex items-center gap-2 rounded-xl border bg-[color:var(--color-surface-2)]/60 px-3 py-1.5 text-xs ${toneClass}`}
    >
      {children}
    </div>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p className="mt-2 text-xs text-[color:var(--color-danger)]">{text}</p>
  );
}

function LabelRow({
  label,
  actionType,
}: {
  label: string;
  actionType: string;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <div className="text-[11px] uppercase tracking-wide text-[color:var(--color-muted)]">
        {label}
      </div>
      <div className="text-[10px] text-[color:var(--color-muted)] font-mono">
        {actionType}
      </div>
    </div>
  );
}

function Actions({
  onAccept,
  onEdit,
  onReject,
  pending,
  acceptLabel = "Add to map",
}: {
  onAccept: () => void;
  onEdit?: () => void;
  onReject: () => void;
  pending: boolean;
  acceptLabel?: string;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onAccept}
        disabled={pending}
        className="rounded-md bg-[color:var(--color-primary)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
      >
        {pending ? "…" : acceptLabel}
      </button>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          disabled={pending}
          className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs disabled:opacity-50"
        >
          Edit
        </button>
      ) : null}
      <button
        type="button"
        onClick={onReject}
        disabled={pending}
        className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-muted)] hover:text-white disabled:opacity-50"
      >
        Pass
      </button>
    </div>
  );
}

// ==========================================================================
// Card: single-text (goal, behavior, worry, assumption, replace_behavior)
// ==========================================================================

function TextCard({
  proposal,
  payload,
  label,
}: {
  proposal: ItcActionProposal;
  payload: Extract<
    CoachAction,
    | { type: "propose_goal" }
    | { type: "propose_behavior" }
    | { type: "propose_worry" }
    | { type: "propose_assumption" }
    | { type: "replace_behavior" }
  >;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(payload.text);

  function submitAccept() {
    setError(null);
    const fd = new FormData();
    fd.set("proposal_id", proposal.id);
    startTransition(async () => {
      const res = await acceptProposal(fd);
      if (!res.ok) setError(res.reason ?? "Could not add.");
    });
  }

  function submitEdit() {
    setError(null);
    const edited: CoachAction = { ...payload, text: text.trim() };
    const fd = new FormData();
    fd.set("proposal_id", proposal.id);
    fd.set("edited_payload", JSON.stringify(edited));
    startTransition(async () => {
      const res = await editAndAcceptProposal(fd);
      if (!res.ok) setError(res.reason ?? "Could not add.");
      else setEditing(false);
    });
  }

  function submitReject() {
    setError(null);
    const fd = new FormData();
    fd.set("proposal_id", proposal.id);
    startTransition(async () => {
      const res = await rejectProposal(fd);
      if (!res.ok) setError(res.reason ?? "Could not pass.");
    });
  }

  return (
    <CardShell>
      <LabelRow label={label} actionType={payload.type} />
      {editing ? (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-md bg-black/30 border border-[color:var(--color-border)] px-2.5 py-1.5 text-sm"
            disabled={pending}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={submitEdit}
              disabled={pending || text.trim().length === 0}
              className="rounded-md bg-[color:var(--color-primary)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              {pending ? "…" : "Save & add"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setText(payload.text);
              }}
              disabled={pending}
              className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {payload.text}
          </p>
          <Actions
            onAccept={submitAccept}
            onEdit={() => setEditing(true)}
            onReject={submitReject}
            pending={pending}
          />
        </>
      )}
      {error ? <ErrorLine text={error} /> : null}
    </CardShell>
  );
}

// ==========================================================================
// Card: commitments batch
// ==========================================================================

function CommitmentsBatchCard({
  proposal,
  payload,
}: {
  proposal: ItcActionProposal;
  payload: Extract<CoachAction, { type: "propose_commitments_batch" }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useState(payload.items.map((i) => ({ ...i })));

  function submitAccept() {
    setError(null);
    const fd = new FormData();
    fd.set("proposal_id", proposal.id);
    startTransition(async () => {
      const res = await acceptProposal(fd);
      if (!res.ok) setError(res.reason ?? "Could not add.");
    });
  }

  function submitEdit() {
    setError(null);
    const edited: CoachAction = {
      type: "propose_commitments_batch",
      items: items.map((i) => ({ ...i, text: i.text.trim() })),
    };
    const fd = new FormData();
    fd.set("proposal_id", proposal.id);
    fd.set("edited_payload", JSON.stringify(edited));
    startTransition(async () => {
      const res = await editAndAcceptProposal(fd);
      if (!res.ok) setError(res.reason ?? "Could not add.");
      else setEditing(false);
    });
  }

  function submitReject() {
    setError(null);
    const fd = new FormData();
    fd.set("proposal_id", proposal.id);
    startTransition(async () => {
      const res = await rejectProposal(fd);
      if (!res.ok) setError(res.reason ?? "Could not pass.");
    });
  }

  return (
    <CardShell>
      <LabelRow
        label={`${payload.items.length} hidden commitments`}
        actionType={payload.type}
      />
      {editing ? (
        <ol className="space-y-2">
          {items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span className="mt-1 text-xs text-[color:var(--color-muted)]">
                {item.worry_index}.
              </span>
              <textarea
                value={item.text}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...next[idx], text: e.target.value };
                  setItems(next);
                }}
                rows={2}
                className="flex-1 resize-none rounded-md bg-black/30 border border-[color:var(--color-border)] px-2.5 py-1.5 text-sm"
                disabled={pending}
              />
            </li>
          ))}
        </ol>
      ) : (
        <ol className="space-y-1.5">
          {payload.items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2 text-sm">
              <span className="text-[color:var(--color-muted)]">
                {item.worry_index}.
              </span>
              <span className="whitespace-pre-wrap leading-relaxed">
                {item.text}
              </span>
            </li>
          ))}
        </ol>
      )}
      {editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={submitEdit}
            disabled={pending || items.some((i) => i.text.trim().length === 0)}
            className="rounded-md bg-[color:var(--color-primary)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            {pending ? "…" : "Save & lock all"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setItems(payload.items.map((i) => ({ ...i })));
            }}
            disabled={pending}
            className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <Actions
          onAccept={submitAccept}
          onEdit={() => setEditing(true)}
          onReject={submitReject}
          pending={pending}
          acceptLabel="Lock all"
        />
      )}
      {error ? <ErrorLine text={error} /> : null}
    </CardShell>
  );
}

// ==========================================================================
// Card: test design
// ==========================================================================

const TEST_TYPE_OPTIONS: Array<{
  value: "data_mining" | "observation" | "thought_experiment" | "behavioral";
  label: string;
}> = [
  { value: "observation", label: "Self-observation" },
  { value: "data_mining", label: "Data mining" },
  { value: "thought_experiment", label: "Thought experiment" },
  { value: "behavioral", label: "Behavioral" },
];

function TestDesignCard({
  proposal,
  payload,
}: {
  proposal: ItcActionProposal;
  payload: Extract<CoachAction, { type: "save_test_design" }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ ...payload });

  function submitAccept() {
    setError(null);
    const fd = new FormData();
    fd.set("proposal_id", proposal.id);
    startTransition(async () => {
      const res = await acceptProposal(fd);
      if (!res.ok) setError(res.reason ?? "Could not save test.");
    });
  }

  function submitEdit() {
    setError(null);
    const edited: CoachAction = {
      type: "save_test_design",
      test_type: draft.test_type,
      target_date: draft.target_date,
      assumption_says: draft.assumption_says.trim(),
      behavior_change: draft.behavior_change.trim(),
      data_to_collect: draft.data_to_collect.trim(),
      in_order_to_find_out: draft.in_order_to_find_out.trim(),
    };
    const fd = new FormData();
    fd.set("proposal_id", proposal.id);
    fd.set("edited_payload", JSON.stringify(edited));
    startTransition(async () => {
      const res = await editAndAcceptProposal(fd);
      if (!res.ok) setError(res.reason ?? "Could not save test.");
      else setEditing(false);
    });
  }

  function submitReject() {
    setError(null);
    const fd = new FormData();
    fd.set("proposal_id", proposal.id);
    startTransition(async () => {
      const res = await rejectProposal(fd);
      if (!res.ok) setError(res.reason ?? "Could not pass.");
    });
  }

  const typeLabel =
    TEST_TYPE_OPTIONS.find((o) => o.value === payload.test_type)?.label ??
    payload.test_type;

  return (
    <CardShell>
      <LabelRow
        label={`Test design — ${typeLabel} — target ${payload.target_date}`}
        actionType={payload.type}
      />
      {editing ? (
        <div className="space-y-2.5">
          <TestField
            label="My Big Assumption says"
            value={draft.assumption_says}
            onChange={(v) => setDraft({ ...draft, assumption_says: v })}
            disabled={pending}
          />
          <TestField
            label="So I will"
            value={draft.behavior_change}
            onChange={(v) => setDraft({ ...draft, behavior_change: v })}
            disabled={pending}
          />
          <TestField
            label="And collect the following data"
            value={draft.data_to_collect}
            onChange={(v) => setDraft({ ...draft, data_to_collect: v })}
            disabled={pending}
          />
          <TestField
            label="In order to find out"
            value={draft.in_order_to_find_out}
            onChange={(v) => setDraft({ ...draft, in_order_to_find_out: v })}
            disabled={pending}
          />
          <div className="flex gap-2 items-center">
            <label className="text-[11px] uppercase tracking-wide text-[color:var(--color-muted)] w-32">
              Test type
            </label>
            <select
              value={draft.test_type}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  test_type: e.target.value as typeof draft.test_type,
                })
              }
              disabled={pending}
              className="rounded-md bg-black/30 border border-[color:var(--color-border)] px-2 py-1 text-xs"
            >
              {TEST_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 items-center">
            <label className="text-[11px] uppercase tracking-wide text-[color:var(--color-muted)] w-32">
              Target date
            </label>
            <input
              type="date"
              value={draft.target_date}
              onChange={(e) =>
                setDraft({ ...draft, target_date: e.target.value })
              }
              disabled={pending}
              className="rounded-md bg-black/30 border border-[color:var(--color-border)] px-2 py-1 text-xs"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={submitEdit}
              disabled={pending}
              className="rounded-md bg-[color:var(--color-primary)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              {pending ? "…" : "Save test"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft({ ...payload });
              }}
              disabled={pending}
              className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <dl className="space-y-1.5 text-sm leading-relaxed">
            <TestReadRow label="My Big Assumption says" value={payload.assumption_says} />
            <TestReadRow label="So I will" value={payload.behavior_change} />
            <TestReadRow
              label="And collect the following data"
              value={payload.data_to_collect}
            />
            <TestReadRow
              label="In order to find out"
              value={payload.in_order_to_find_out}
            />
          </dl>
          <Actions
            onAccept={submitAccept}
            onEdit={() => setEditing(true)}
            onReject={submitReject}
            pending={pending}
            acceptLabel="Save test"
          />
        </>
      )}
      {error ? <ErrorLine text={error} /> : null}
    </CardShell>
  );
}

function TestField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] uppercase tracking-wide text-[color:var(--color-muted)]">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        disabled={disabled}
        className="w-full resize-none rounded-md bg-black/30 border border-[color:var(--color-border)] px-2.5 py-1.5 text-sm"
      />
    </div>
  );
}

function TestReadRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-[color:var(--color-muted)]">
        {label}
      </dt>
      <dd className="whitespace-pre-wrap">{value}</dd>
    </div>
  );
}

// ==========================================================================
// Card: test results
// ==========================================================================

const VERDICT_OPTIONS: Array<{
  value: "held" | "partially_challenged" | "challenged";
  label: string;
}> = [
  { value: "held", label: "Held" },
  { value: "partially_challenged", label: "Partially challenged" },
  { value: "challenged", label: "Challenged" },
];

const NEXT_STEP_OPTIONS: Array<{
  value: "new_test" | "new_assumption" | "map_complete";
  label: string;
}> = [
  { value: "new_test", label: "New test on same assumption" },
  { value: "new_assumption", label: "Test a different assumption" },
  { value: "map_complete", label: "Map complete" },
];

function TestResultsCard({
  proposal,
  payload,
}: {
  proposal: ItcActionProposal;
  payload: Extract<CoachAction, { type: "record_test_results" }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ ...payload });

  function submitAccept() {
    setError(null);
    const fd = new FormData();
    fd.set("proposal_id", proposal.id);
    startTransition(async () => {
      const res = await acceptProposal(fd);
      if (!res.ok) setError(res.reason ?? "Could not record results.");
    });
  }

  function submitEdit() {
    setError(null);
    const edited: CoachAction = {
      type: "record_test_results",
      ran_on: draft.ran_on,
      what_i_did: draft.what_i_did.trim(),
      data_collected: draft.data_collected.trim(),
      what_it_says_about_assumption: draft.what_it_says_about_assumption.trim(),
      assumption_verdict: draft.assumption_verdict,
      next_step: draft.next_step,
    };
    const fd = new FormData();
    fd.set("proposal_id", proposal.id);
    fd.set("edited_payload", JSON.stringify(edited));
    startTransition(async () => {
      const res = await editAndAcceptProposal(fd);
      if (!res.ok) setError(res.reason ?? "Could not record results.");
      else setEditing(false);
    });
  }

  function submitReject() {
    setError(null);
    const fd = new FormData();
    fd.set("proposal_id", proposal.id);
    startTransition(async () => {
      const res = await rejectProposal(fd);
      if (!res.ok) setError(res.reason ?? "Could not pass.");
    });
  }

  const verdictLabel =
    VERDICT_OPTIONS.find((v) => v.value === payload.assumption_verdict)?.label ??
    payload.assumption_verdict;
  const nextLabel =
    NEXT_STEP_OPTIONS.find((n) => n.value === payload.next_step)?.label ??
    payload.next_step;

  return (
    <CardShell>
      <LabelRow
        label={`Test results — ${verdictLabel} → ${nextLabel}`}
        actionType={payload.type}
      />
      {editing ? (
        <div className="space-y-2.5">
          <TestField
            label="What I did"
            value={draft.what_i_did}
            onChange={(v) => setDraft({ ...draft, what_i_did: v })}
            disabled={pending}
          />
          <TestField
            label="What I observed"
            value={draft.data_collected}
            onChange={(v) => setDraft({ ...draft, data_collected: v })}
            disabled={pending}
          />
          <TestField
            label="What it tells me"
            value={draft.what_it_says_about_assumption}
            onChange={(v) =>
              setDraft({ ...draft, what_it_says_about_assumption: v })
            }
            disabled={pending}
          />
          <div className="flex gap-2 items-center">
            <label className="text-[11px] uppercase tracking-wide text-[color:var(--color-muted)] w-32">
              Verdict
            </label>
            <select
              value={draft.assumption_verdict}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  assumption_verdict: e.target
                    .value as typeof draft.assumption_verdict,
                })
              }
              disabled={pending}
              className="rounded-md bg-black/30 border border-[color:var(--color-border)] px-2 py-1 text-xs"
            >
              {VERDICT_OPTIONS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 items-center">
            <label className="text-[11px] uppercase tracking-wide text-[color:var(--color-muted)] w-32">
              Next step
            </label>
            <select
              value={draft.next_step}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  next_step: e.target.value as typeof draft.next_step,
                })
              }
              disabled={pending}
              className="rounded-md bg-black/30 border border-[color:var(--color-border)] px-2 py-1 text-xs"
            >
              {NEXT_STEP_OPTIONS.map((n) => (
                <option key={n.value} value={n.value}>
                  {n.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={submitEdit}
              disabled={pending}
              className="rounded-md bg-[color:var(--color-primary)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              {pending ? "…" : "Record results"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft({ ...payload });
              }}
              disabled={pending}
              className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <dl className="space-y-1.5 text-sm leading-relaxed">
            <TestReadRow label="What I did" value={payload.what_i_did} />
            <TestReadRow label="What I observed" value={payload.data_collected} />
            <TestReadRow
              label="What it tells me"
              value={payload.what_it_says_about_assumption}
            />
          </dl>
          <Actions
            onAccept={submitAccept}
            onEdit={() => setEditing(true)}
            onReject={submitReject}
            pending={pending}
            acceptLabel="Record results"
          />
        </>
      )}
      {error ? <ErrorLine text={error} /> : null}
    </CardShell>
  );
}

// ==========================================================================
// Card: recommendation (accept-or-pass — no free-text edit)
// ==========================================================================

function RecommendationCard({
  proposal,
  payload,
}: {
  proposal: ItcActionProposal;
  payload: Extract<
    CoachAction,
    { type: "recommend_assumption_for_testing" }
  >;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submitAccept() {
    setError(null);
    const fd = new FormData();
    fd.set("proposal_id", proposal.id);
    startTransition(async () => {
      const res = await acceptProposal(fd);
      if (!res.ok) setError(res.reason ?? "Could not select.");
    });
  }

  function submitReject() {
    setError(null);
    const fd = new FormData();
    fd.set("proposal_id", proposal.id);
    startTransition(async () => {
      const res = await rejectProposal(fd);
      if (!res.ok) setError(res.reason ?? "Could not pass.");
    });
  }

  return (
    <CardShell>
      <LabelRow
        label={`Recommendation: test assumption #${payload.assumption_index}`}
        actionType={payload.type}
      />
      <p className="whitespace-pre-wrap text-sm leading-relaxed">
        {payload.reason}
      </p>
      <Actions
        onAccept={submitAccept}
        onReject={submitReject}
        pending={pending}
        acceptLabel={`Go with #${payload.assumption_index}`}
      />
      {error ? <ErrorLine text={error} /> : null}
    </CardShell>
  );
}

// ==========================================================================
// Card: remove behavior (single confirm button, no free-text edit)
// ==========================================================================

function RemoveBehaviorCard({
  proposal,
  payload,
}: {
  proposal: ItcActionProposal;
  payload: Extract<CoachAction, { type: "remove_behavior" }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submitAccept() {
    setError(null);
    const fd = new FormData();
    fd.set("proposal_id", proposal.id);
    startTransition(async () => {
      const res = await acceptProposal(fd);
      if (!res.ok) setError(res.reason ?? "Could not remove.");
    });
  }

  function submitReject() {
    setError(null);
    const fd = new FormData();
    fd.set("proposal_id", proposal.id);
    startTransition(async () => {
      const res = await rejectProposal(fd);
      if (!res.ok) setError(res.reason ?? "Could not pass.");
    });
  }

  return (
    <CardShell>
      <LabelRow
        label={`Remove behavior #${payload.index}`}
        actionType={payload.type}
      />
      <p className="text-sm text-[color:var(--color-muted)]">
        Coach flagged behavior #{payload.index} for removal. Confirm to drop it
        from the map.
      </p>
      <Actions
        onAccept={submitAccept}
        onReject={submitReject}
        pending={pending}
        acceptLabel="Remove"
      />
      {error ? <ErrorLine text={error} /> : null}
    </CardShell>
  );
}

// ==========================================================================
// Labels
// ==========================================================================

function lockedLabel(type: CoachAction["type"]): string {
  switch (type) {
    case "propose_goal":
      return "Goal locked in";
    case "propose_behavior":
      return "Behavior added";
    case "propose_worry":
      return "Worry locked in";
    case "propose_commitments_batch":
      return "Hidden commitments locked in";
    case "propose_assumption":
      return "Big Assumption locked in";
    case "save_test_design":
      return "Test saved";
    case "record_test_results":
      return "Results recorded";
    case "recommend_assumption_for_testing":
      return "Recommendation accepted";
    case "replace_behavior":
      return "Behavior refined";
    case "remove_behavior":
      return "Behavior removed";
    default:
      return "Added to map";
  }
}

function humanType(type: string): string {
  return type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
