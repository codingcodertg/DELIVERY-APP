import { EmpleadosDelTt } from "@/components/timetracker/EmpleadosDelTt";
import { MarcoDelTtEnRrhh } from "@/components/timetracker/MarcoDelTtEnRrhh";

export const dynamic = "force-dynamic";

/**
 * «⏱ Time tracking setup» (tt/a-hr): la antigua pestaña «Employees» del Time Tracker, ahora en RR. HH.
 * El acceso (solo admins del Time Tracker) lo decide MarcoDelTtEnRrhh en el servidor.
 */
export default function TtEmpleadosPage() {
  return (
    <MarcoDelTtEnRrhh>
      <EmpleadosDelTt />
    </MarcoDelTtEnRrhh>
  );
}
