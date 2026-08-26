"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * Whether the ERP's left sidebar is collapsed, shared between the sidebar itself and the wrapper
 * that offsets the page content.
 *
 * A context rather than local state in SideNav because the two live in different trees: the layout
 * renders the content wrapper, while <Header/> — and so the sidebar — is rendered by each page. The
 * padding that keeps content clear of a `fixed` sidebar has to move with it, and only the layout is
 * in a position to apply it.
 */
const KEY = "erp_nav_collapsed";

const Ctx = createContext<{ collapsed: boolean; toggle: () => void }>({
  collapsed: false,
  toggle: () => {},
});

export const useErpNav = () => useContext(Ctx);

export function ErpNavProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  // Read after mount, not during render: localStorage does not exist on the server, and seeding
  // state from it directly would make the server and client markup disagree.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(KEY) === "1");
    } catch {
      /* private mode, blocked storage — expanded is a fine default */
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(KEY, next ? "1" : "0");
      } catch {
        /* the preference just will not persist */
      }
      return next;
    });
  }, []);

  return (
    <Ctx.Provider value={{ collapsed, toggle }}>
      {/* The sidebar is `fixed`, so it does not take space in flow — without this padding it sits
          on top of the page content. rtg-erp applies the same 14rem offset from its root layout;
          the port had dropped it, which is why the catalog was partly hidden underneath. */}
      {/* Collapsed still reserves a narrow gutter (3rem) rather than dropping to zero: the
          "show menu" button is fixed in that corner, and with no offset it sat on top of the page
          heading. Expanded reserves the sidebar's full 14rem. */}
      <div className={collapsed ? "lg:pl-12" : "lg:pl-56"}>{children}</div>
    </Ctx.Provider>
  );
}
