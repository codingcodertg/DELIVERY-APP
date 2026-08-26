"use client";

import { useEffect, useState } from "react";

/**
 * Filter the (server-rendered) payroll timesheets by employee name. The store
 * groups and cards are already on the page; this just hides the ones that don't
 * match and opens the groups that do, so a search works alongside the store
 * dropdowns without re-fetching anything.
 */
export default function PayrollSearch({ placeholder }: { placeholder: string }) {
  const [q, setQ] = useState("");

  useEffect(() => {
    const term = q.trim().toLowerCase();
    const cards = document.querySelectorAll<HTMLElement>("[data-emp-name]");
    for (const card of cards) {
      const name = card.getAttribute("data-emp-name") ?? "";
      card.style.display = !term || name.includes(term) ? "" : "none";
    }
    // Hide store groups with no visible members; open the ones that match.
    const groups = document.querySelectorAll<HTMLDetailsElement>("[data-store-group]");
    for (const g of groups) {
      const visible = [...g.querySelectorAll<HTMLElement>("[data-emp-name]")].some((c) => c.style.display !== "none");
      g.style.display = visible ? "" : "none";
      if (term && visible) g.open = true;
    }
  }, [q]);

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 pr-10 text-sm focus:outline-none focus:border-emerald-500"
      />
      {q && (
        <button
          type="button"
          onClick={() => setQ("")}
          aria-label="Clear"
          className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          ✕
        </button>
      )}
    </div>
  );
}
