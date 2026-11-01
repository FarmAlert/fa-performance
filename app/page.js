import { Suspense } from "react";
import PerfApp from "./_app/PerfApp";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <div className="pa">
      <Suspense fallback={null}>
        <PerfApp />
      </Suspense>
    </div>
  );
}
