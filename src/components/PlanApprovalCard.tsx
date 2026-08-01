import type { PendingPlan } from "../lib/approvals";

type Props = {
  pending: PendingPlan;
  agentLabel?: string;
  busy?: boolean;
  onApprove: () => void;
  onCancel: () => void;
  onDismiss?: () => void;
};

/**
 * Ask-mode plan approval (x.ai/exit_plan_mode → acp://plan-approval).
 */
export function PlanApprovalCard({
  pending,
  agentLabel,
  busy,
  onApprove,
  onCancel,
  onDismiss,
}: Props) {
  const preview = (pending.planContent || "").trim();
  const excerpt =
    preview.length > 480 ? `${preview.slice(0, 480)}…` : preview || "(No plan text in payload)";

  return (
    <div
      className="approval-card approval-card--plan"
      role="alertdialog"
      aria-label="Plan approval"
    >
      <div className="approval-card-head">
        <span className="approval-badge approval-badge--plan">Plan</span>
        <span className="approval-agent">
          {agentLabel || pending.sessionId.slice(0, 8)}
        </span>
        {onDismiss ? (
          <button type="button" className="approval-dismiss" onClick={onDismiss}>
            Hide
          </button>
        ) : null}
      </div>
      <p className="approval-summary">Agent finished planning — approve to continue.</p>
      <pre className="approval-plan-body">{excerpt}</pre>
      <div className="approval-actions">
        <button
          type="button"
          className="approval-btn approval-btn--deny"
          disabled={!!busy}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="approval-btn approval-btn--allow"
          disabled={!!busy}
          onClick={onApprove}
        >
          Approve plan
        </button>
      </div>
    </div>
  );
}
