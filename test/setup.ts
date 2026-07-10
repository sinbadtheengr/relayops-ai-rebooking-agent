// Must run before any import of src/config.ts, which parses env at import time.
// An in-memory SQLite db keeps tests hermetic and fast; the db singleton lives
// for the lifetime of this test-file worker.
process.env.DATABASE_URL = ":memory:";
delete process.env.OPENAI_API_KEY; // force the deterministic agent path in tests
