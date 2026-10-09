import { describe, expect, it } from "vitest";
import { buildFeed } from "@/lib/feed";
import { DEFAULT_CONFIG } from "@/lib/config";
import { quotePending } from "@/lib/state";
import { buildDemoState } from "./seed";

const NOW = new Date("2026-10-10T12:00:00Z");

describe("demo state", () => {
  it("resolves the made-up visits through the real engine and leaves three IPs pending", async () => {
    const s = await buildDemoState(NOW);
    const feed = buildFeed(s.visits, s.resolutions, s.companies, DEFAULT_CONFIG);
    expect(feed.companies.length).toBe(6);
    expect(feed.companies.filter((c) => c.icp.matched).map((c) => c.domain).sort()).toEqual(["brightloop.example", "harborfinch.example", "lumenretail.example", "orbitpay.example"]);
    expect(feed.excluded.byReason).toMatchObject({ isp: 5, hosting: 1, vpn: 1, private_ip: 1 });
    expect(Object.keys(s.pendingIps)).toHaveLength(3);
    expect(quotePending(s, DEFAULT_CONFIG, 1_000_000).maxMicros).toBe(7200);
  });
});
