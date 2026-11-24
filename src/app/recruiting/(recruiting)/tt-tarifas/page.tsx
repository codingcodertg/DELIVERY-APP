import { AssignmentsPanel } from "@/components/timetracker/AssignmentsPanel";
import { MarcoDelTtEnRrhh } from "@/components/timetracker/MarcoDelTtEnRrhh";

export const dynamic = "force-dynamic";

/**
 * «💲 Pay rates» (tt/a-hr): las tarifas por proyecto del Time Tracker (antes «Assignments & Schedule
 * → Rates»), ahora en RR. HH. El acceso (solo admins del Time Tracker) lo decide MarcoDelTtEnRrhh.
 */
export default function TtTarifasPage() {
  return (
    <MarcoDelTtEnRrhh>
      <AssignmentsPanel />
    </MarcoDelTtEnRrhh>
  );
}
