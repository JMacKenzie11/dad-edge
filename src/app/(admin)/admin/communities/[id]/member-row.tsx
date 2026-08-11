import Link from "next/link";
import { moveMember, assignLeader } from "../actions";
import { format } from "date-fns";

export function MemberRow({
  communityId,
  membershipId: _membershipId,
  userId,
  email,
  name,
  role,
  status,
  subscriptionStatus,
  lastSeenAt,
  otherCommunities,
}: {
  communityId: string;
  membershipId: string;
  userId: string;
  email: string;
  name: string;
  role: "member" | "leader";
  status: "active" | "inactive" | "removed";
  subscriptionStatus: string;
  lastSeenAt: string | null;
  otherCommunities: { id: string; name: string }[];
}) {
  return (
    <li className="px-4 py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Link
          href={`/admin/users/${userId}`}
          className="text-sm hover:text-[color:var(--color-accent)] block truncate"
        >
          {name || email}
        </Link>
        <p className="text-xs text-[color:var(--color-text-muted)] truncate">
          {email}
          {lastSeenAt ? ` · seen ${format(new Date(lastSeenAt), "MMM d")}` : " · never seen"}
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span
          className="text-[10px] font-heading tracking-widest"
          style={{
            color:
              subscriptionStatus === "active" || subscriptionStatus === "comped"
                ? "var(--color-success)"
                : subscriptionStatus === "past_due"
                  ? "var(--color-warning)"
                  : "var(--color-text-muted)",
          }}
        >
          {subscriptionStatus.toUpperCase()}
        </span>
        <span
          className="text-[10px] font-heading tracking-widest"
          style={{
            color: role === "leader" ? "var(--color-accent)" : "var(--color-text-muted)",
          }}
        >
          {role.toUpperCase()}
        </span>
        <span
          className="text-[10px] font-heading tracking-widest"
          style={{
            color:
              status === "active"
                ? "var(--color-success)"
                : status === "inactive"
                  ? "var(--color-warning)"
                  : "var(--color-danger)",
          }}
        >
          {status.toUpperCase()}
        </span>
        {role !== "leader" ? (
          <form action={assignLeader}>
            <input type="hidden" name="community_id" value={communityId} />
            <input type="hidden" name="user_id" value={userId} />
            <button className="text-[10px] font-heading tracking-widest px-2 h-7 rounded border border-[color:var(--color-border)] hover:border-[color:var(--color-accent)]">
              MAKE LEADER
            </button>
          </form>
        ) : null}
        {otherCommunities.length > 0 && status === "active" ? (
          <form action={moveMember} className="flex items-center gap-1">
            <input type="hidden" name="user_id" value={userId} />
            <input type="hidden" name="from_community_id" value={communityId} />
            <select
              name="to_community_id"
              className="h-7 text-[10px] px-1 rounded bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
              defaultValue=""
              required
            >
              <option value="" disabled>
                MOVE TO…
              </option>
              {otherCommunities.map((oc) => (
                <option key={oc.id} value={oc.id}>
                  {oc.name}
                </option>
              ))}
            </select>
            <button className="text-[10px] font-heading tracking-widest px-2 h-7 rounded border border-[color:var(--color-border)] hover:border-[color:var(--color-accent)]">
              GO
            </button>
          </form>
        ) : null}
      </div>
    </li>
  );
}
