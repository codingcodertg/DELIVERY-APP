"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markAllRead } from "@/app/timetracker/clock-in/actions/notifications";

/** Marks the user's notifications read once the inbox is opened. */
export default function MarkReadOnView({ hasUnread }: { hasUnread: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!hasUnread) return;
    markAllRead().then(() => router.refresh());
  }, [hasUnread, router]);
  return null;
}
