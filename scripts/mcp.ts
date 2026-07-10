import { listCustomerRecords } from "../src/db.js";
import { seedDemoData } from "../src/demoData.js";
import { startMcpServer } from "../src/mcp/server.js";

// Keep the credential-free demo working: seed the local db on first run so an
// MCP client sees data immediately, exactly like the other CLI entry points.
if (listCustomerRecords().length === 0) {
  seedDemoData();
}

await startMcpServer();
