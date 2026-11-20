import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const dir = mkdtempSync(join(realpathSync(tmpdir()), "relayops-test-"));
Object.assign(process.env, {
  RELAYOPS_DATA_DIR: dir,
  RELAYOPS_CLIENT_ID: "test-spa",
  RELAYOPS_SENDER_NAME: "Example Spa",
  RELAYOPS_CONTACT_EMAIL: "desk@example.test",
  RELAYOPS_MAILING_ADDRESS: "100 Example St, Toronto ON",
  RELAYOPS_ENABLE_OPENAI: "false",
  SLACK_TEAM_ID: "T_TEST",
  RELAYOPS_STAFF_IDS: "U_APPROVER,U_SENDER",
  TIMEZONE: "America/Toronto"
});
afterAll(async () => {
  (await import("../src/db.js")).closeDb();
  rmSync(dir, { recursive: true, force: true });
});
