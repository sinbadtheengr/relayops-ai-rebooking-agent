import { beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { auditTrail, messageRecord } from "../src/relayops.js";
import { load } from "./fixtures.js";
import { createRelayOpsMcpServer } from "../src/mcp/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const mock = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  actions: [] as { pattern: RegExp; handler: Function }[],
  jobs: new Map<string, Function>(),
  post: vi.fn(),
  ephemeral: vi.fn(),
  publish: vi.fn()
}));
vi.mock("node-cron", () => ({ default: { schedule: (expr: string, cb: Function) => mock.jobs.set(expr, cb) } }));
vi.mock("@slack/bolt", () => ({
  LogLevel: { INFO: "info" },
  App: class {
    client = {
      auth: { test: async () => ({ team_id: "T_TEST" }) },
      chat: { postMessage: mock.post, postEphemeral: mock.ephemeral },
      views: { publish: mock.publish }
    };
    command(key: string, handler: Function) {
      mock.handlers.set(key, handler);
    }
    event(key: string, handler: Function) {
      mock.handlers.set(key, handler);
    }
    action(pattern: RegExp, handler: Function) {
      mock.actions.push({ pattern, handler });
    }
    message(handler: Function) {
      mock.handlers.set("message", handler);
    }
    async start() {}
  }
}));
async function slash(text: string, user = "U_APPROVER", team = "T_TEST") {
  const respond = vi.fn();
  await mock.handlers.get("/relayops")!({
    command: { team_id: team, user_id: user, text },
    ack: vi.fn(),
    respond
  });
  return respond.mock.calls[0][0];
}
async function click(actionId: string, value: string, user = "U_APPROVER") {
  const respond = vi.fn();
  await mock.actions
    .find((a) => a.pattern.test(actionId))!
    .handler({
      ack: vi.fn(),
      respond,
      action: { type: "button", action_id: actionId, value },
      body: { team: { id: "T_TEST" }, user: { id: user }, response_url: "mock" },
      client: {}
    });
  return respond.mock.calls[0][0];
}
beforeAll(async () => {
  Object.assign(config, {
    slackBotToken: "test",
    slackAppToken: "test",
    slackSigningSecret: "test",
    slackReportChannelId: "C_STAFF",
    dailyScanEnabled: false
  });
  await import("../src/app.js");
  load();
});

describe("pilot entry points", () => {
  it("denies foreign workspaces, unlisted users, stale shortcuts and unauthorized button presses", async () => {
    for (const result of [
      await slash("scan", "U_VISITOR"),
      await slash("scan", "U_APPROVER", "T_OTHER"),
      await click("draft_customer", "c1", "U_VISITOR")
    ]) {
      expect(result.text).toContain("restricted");
      expect(result.blocks).toBeUndefined();
    }
    expect((await click("mark_contacted", "c1")).text).toContain("approve a draft");
    const say = vi.fn();
    await mock.handlers.get("message")!({
      message: { channel_type: "im", user: "U_VISITOR", text: "scan" },
      body: { team_id: "T_TEST" },
      say
    });
    expect(say.mock.calls[0][0].text).toContain("restricted");
    await mock.handlers.get("message")!({
      message: { channel_type: "im", user: "U_APPROVER", bot_id: "bot", text: "scan" },
      body: { team_id: "T_TEST" },
      say
    });
    expect(say).toHaveBeenCalledTimes(1);
  });
  it("keeps customer info private in channels and gates every manual delivery step from the staff UI", async () => {
    const scan = await slash("scan");
    expect(scan.response_type).toBe("ephemeral");
    expect(JSON.stringify(scan.blocks)).not.toContain("mark_contacted");
    await mock.handlers.get("app_mention")!({
      event: { user: "U_APPROVER", text: "<@APP> scan", channel: "C_PUBLIC" },
      body: { team_id: "T_TEST" },
      client: { chat: { postEphemeral: mock.ephemeral } }
    });
    expect(mock.ephemeral).toHaveBeenCalledWith(
      expect.objectContaining({ user: "U_APPROVER", channel: "C_PUBLIC" })
    );
    expect((await click("draft_customer", "wrong-spa/c1")).text).toContain("current pilot");
    const buttonValue = scan.blocks.find((block: any) => block.type === "actions").elements[0].value;
    const draft = await click("draft_customer", buttonValue);
    const approvalValue = draft.blocks[1].elements[0].value;
    const id = approvalValue.split("/")[1];
    expect((await slash("deliver " + id)).text).toContain("approval");
    expect((await click("approve_message", approvalValue)).text).toContain("Approved");
    expect((await slash("deliver " + id, "U_SENDER")).text).toContain("avery@example.test");
    expect((await slash("sent " + id, "U_SENDER")).text).toContain("Manual send recorded");
    const at = new Date().toISOString();
    expect((await slash(`reply ${id} optout inbox-3 ${at}`)).text).toContain("withdrawal recorded");
    const record = messageRecord(id);
    expect(record.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "approved", actor: "slack:U_APPROVER" }),
        expect.objectContaining({ kind: "sent", actor: "slack:U_SENDER" })
      ])
    );
    expect(record.withdrawals).toHaveLength(1);
    expect(mock.post).not.toHaveBeenCalled();
  });
  it("saves the scheduled weekly report and posts only its totals to the configured channel", async () => {
    await mock.jobs.get("0 8 * * 1")!();
    const call = mock.post.mock.calls.at(-1)![0];
    expect(call.channel).toBe("C_STAFF");
    expect(call.text).toMatch(/Overdue clients:[\s\S]*Recovered revenue/);
    expect(call.text).not.toContain("Avery");
    expect(auditTrail()).toEqual(
      expect.arrayContaining([expect.objectContaining({ actor: "system:scheduler", action: "report.generated" })])
    );
    expect((await slash("weekly")).text).toContain("Drafts approved");
  });
  it("exposes no MCP approval, send or bypass and uses the same isolated data", async () => {
    const server = createRelayOpsMcpServer();
    const client = new Client({ name: "pilot-test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(a);
      await client.connect(b);
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "draft_follow_up",
        "get_rebooking_opportunities",
        "list_recently_contacted",
        "summarize_today"
      ]);
      const result = await client.callTool({ name: "summarize_today", arguments: {} });
      expect(JSON.stringify(result.content)).toContain("overdue customers");
      expect(auditTrail()).toEqual(
        expect.arrayContaining([expect.objectContaining({ actor: "agent:mcp", action: "scan" })])
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});
