import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImpactOutput } from "@/scripts/score-impact";
import { Dashboard } from "@/components/Dashboard";

async function getImpactData(): Promise<ImpactOutput> {
  const raw = await readFile(
    join(process.cwd(), "data", "engineer-impact.json"),
    "utf8",
  );
  return JSON.parse(raw) as ImpactOutput;
}

export default async function Page() {
  const data = await getImpactData();
  return <Dashboard data={data} />;
}
