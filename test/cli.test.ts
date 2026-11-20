import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { config } from "../src/config.js";
import { csv } from "./fixtures.js";

const run = promisify(execFile);
function cli(...args: string[]) {
  return run(process.execPath, ["--import", "tsx", "scripts/pilot.ts", ...args], { env: process.env }).then((r) =>
    r.stdout.trim()
  );
}
it("imports through the CLI and serializes simultaneous delivery claims from separate processes", async () => {
  const file = join(config.dataDir, "synthetic booking export.csv");
  writeFileSync(file, csv([{}]));
  expect(await cli("import", config.clientId, file, "2025-01-01T00:00:00Z")).toContain('"profiles":1');
  const draft = async () => {
    const output = await cli("draft", "c1");
    const id = output.match(/^Draft ([\w-]+) for/)![1];
    await cli("approve", id);
    return id;
  };
  const ids = await Promise.all([draft(), draft()]);
  const claims = await Promise.allSettled(ids.map((id) => cli("deliver", id)));
  expect(claims.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const winner = ids[claims.findIndex((r) => r.status === "fulfilled")];
  await cli("sent", winner);
  const history = JSON.parse(await cli("record", winner));
  expect(history.events.map((e: { kind: string }) => e.kind)).toEqual(["approved", "released", "sent"]);
  expect(history.consentImport.digest).toMatch(/^[0-9a-f]{64}$/);
  expect(await cli("weekly")).toContain("Recovered revenue (CAD)");
  const logs = JSON.parse(await cli("audit"));
  expect(logs).toEqual(
    expect.arrayContaining([expect.objectContaining({ action: "message.release", outcome: "failed" })])
  );
}, 30000);
