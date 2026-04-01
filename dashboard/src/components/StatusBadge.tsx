type Props = {
  status: string;
  label?: string;
};

const statusStyles: Record<string, string> = {
  ok: "badge-success",
  degraded: "badge-warning",
  down: "badge-error",
  unknown: "badge-ghost",
};

export function StatusBadge({ status, label }: Props) {
  const style = statusStyles[status] ?? "badge-ghost";
  return (
    <span className={`badge badge-sm ${style}`}>
      {label ?? status}
    </span>
  );
}
