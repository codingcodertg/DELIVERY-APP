import "./erp.css";

/**
 * The ERP section's shell (D-090).
 *
 * `data-app="erp"` is load-bearing, not decoration: erp.css deliberately does NOT import Tailwind's
 * preflight, because that is a global reset and every other screen in this app was built without
 * it. The stand-in reset is scoped to this attribute, so it applies here and stops here.
 */
export default function ErpLayout({ children }: { children: React.ReactNode }) {
  return <div data-app="erp">{children}</div>;
}
