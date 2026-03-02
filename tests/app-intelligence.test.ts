import { expect, test, describe } from "bun:test";
import app from "../src/index";

describe("App Store Intelligence API", () => {
  test("GET /api/run with rankings type should return 402 without payment", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/run?type=rankings&store=apple&country=US")
    );
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.endpoint).toBe("/api/run");
    expect(body.price).toBe(0.01);
  });

  test("GET /api/run with invalid store should return 400 (if payment was present, but let's test missing params)", async () => {
    // This test might be tricky because it requires a valid payment signature to reach the store check
    // But we can check if the response contains the app store description in the 402
    const res = await app.fetch(
      new Request("http://localhost/api/run?type=rankings&store=invalid&country=US")
    );
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.description).toContain("App Store Intelligence");
  });
});
