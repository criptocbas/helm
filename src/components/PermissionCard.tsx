import type { PendingPermission } from "../lib/approvals";
import { pickAllowOption, pickDenyOption } from "../lib/approvals";

type Props = {
  pending: PendingPermission;
  agentLabel?: string;
  busy?: boolean;
  onAllow: (optionId: string) => void;
  onDeny: (optionId: string | null) => void;
  onDismiss?: () => void;
};

/**
 * Ask-mode tool permission control — allow once / deny.
 */
export function PermissionCard({
  pending,
  agentLabel,
  busy,
  onAllow,
  onDeny,
  onDismiss,
}: Props) {
  const allowId = pickAllowOption(pending.options);
  const denyId = pickDenyOption(pending.options);

  return (
    <div
      className="approval-card approval-card--permission"
      role="alertdialog"
      aria-label="Permission required"
    >
      <div className="approval-card-head">
        <span className="approval-badge">Permission</span>
        <span className="approval-agent">
          {agentLabel || pending.sessionId?.slice(0, 8) || "Agent"}
        </span>
        {onDismiss ? (
          <button
            type="button"
            className="approval-dismiss"
            onClick={onDismiss}
            title="Hide card (request still pending until you allow/deny)"
          >
            Hide
          </button>
        ) : null}
      </div>
      <p className="approval-summary">{pending.summary}</p>
      <p className="approval-hint">
        Ask mode — choose once. Auto mode would approve without this card.
      </p>
      <div className="approval-actions">
        <button
          type="button"
          className="approval-btn approval-btn--deny"
          disabled={!!busy}
          onClick={() => onDeny(denyId)}
        >
          Deny
        </button>
        <button
          type="button"
          className="approval-btn approval-btn--allow"
          disabled={!!busy || !allowId}
          onClick={() => allowId && onAllow(allowId)}
        >
          Allow
        </button>
      </div>
    </div>
  );
}
