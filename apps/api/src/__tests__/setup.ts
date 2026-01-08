// Test setup for API integration tests
import { beforeAll, afterAll, beforeEach } from "vitest";
import { testPrisma, resetDatabase } from "@project/db/testing";

// Enable dev credentials for testing
process.env.NODE_ENV = "test";
process.env.ENABLE_DEV_CREDENTIALS = "true";

beforeAll(async () => {
  // Ensure database is available
  await testPrisma.$connect();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});
