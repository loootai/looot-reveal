import { describe, expect, it } from "vitest";
import { buildFeed } from "@/lib/feed";
import { quotePending } from "@/lib/state";
import { buildDemoState, DEMO_CONFIG } from "./seed";

const NOW = new Date("2026-10-10T12:00:00Z");

describe("demo state", () => {
  it("resolves the made-up visits through the real engine and leaves three IPs pending", async () => {
    const s = await buildDemoState(NOW);
    const feed = buildFeed(s.visits, s.resolutions, s.companies, DEMO_CONFIG);
    expect(feed.companies.length).toBe(8);
    expect(feed.companies.filter((c) => c.icp.matched).map((c) => c.domain).sort()).toEqual(["brightloop.example", "deltaworks.example", "harborfinch.example", "lumenretail.example", "marlowpike.example", "orbitpay.example"]);
    expect(feed.excluded.byReason).toMatchObject({ isp: 6, vpn: 1, private_ip: 1 });
    expect(Object.keys(s.pendingIps)).toHaveLength(3);
    expect(quotePending(s, DEMO_CONFIG, 1_000_000, NOW).maxMicros).toBe(847_200);
  });
  it("shows People Data Labs answering the unsettled addresses and one disagreement", async () => {
    const s = await buildDemoState(NOW);
    const feed = buildFeed(s.visits, s.resolutions, s.companies, DEMO_CONFIG);
    const by = (d: string) => feed.companies.find((c) => c.domain === d)!;
    expect(by("deltaworks.example")).toMatchObject({ confidence: "high", answeredBy: [{ provider: "people-data-labs" }] });
    expect(by("marlowpike.example")).toMatchObject({ confidence: "low", alternatives: [{ provider: "ipinfo", domain: "tandemnet.example" }] });
  });
});
