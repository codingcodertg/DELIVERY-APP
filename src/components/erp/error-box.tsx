// Fail-loud error panel: friendly message + the error code + "Ref: <event id>"
// so a user can hand the Ref over and we look the fault up in Sentry. No hooks —
// usable from server or client components.
import type { ClientError } from "@/lib/erp/error-codes";

export function ErrorBox({
  error,
  title,
  className,
}: {
  error: Partial<ClientError> & { message: string };
  title?: string;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 ${className ?? ""}`}>
      <div className="font-semibold">{title ?? "Something went wrong"}</div>
      <div className="mt-1">{error.message}</div>
      {(error.code || error.ref) && (
        <div className="mt-2 font-mono text-xs text-red-700">
          {error.code && <span>code: {error.code}</span>}
          {error.code && error.ref && <span> · </span>}
          {error.ref && <span>Ref: {error.ref}</span>}
        </div>
      )}
      {error.ref && (
        <div className="mt-1 text-xs text-red-600">
          Share this Ref with support and we can pull up the exact error.
        </div>
      )}
    </div>
  );
}
