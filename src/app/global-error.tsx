"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ maxWidth: 520, margin: "80px auto", textAlign: "center", fontFamily: "sans-serif" }}>
          <div style={{ fontSize: 34 }}>⚠️</div>
          <h2 style={{ margin: "10px 0" }}>Something went wrong</h2>
          <button onClick={() => location.reload()}>Reload app</button>
        </div>
      </body>
    </html>
  );
}
