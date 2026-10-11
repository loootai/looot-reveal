import { describe, expect, it, vi } from "vitest";
import { ConfigSchema, type RevealConfig } from "../config";
import type { LoootRunner } from "../looot";
import { emptyState } from "../state";
import { md5Email, sha256Email } from "./hash";
import { PERSON_CONDITIONS } from "./schema";
import { optOutEmail, purgePerson, runPersonLookups, queuePersonVisit, quotePersonRun, deleteByEmail, importSuppression, type VisitSignals } from "./engine";

const NOW = new Date("2026-10-11T12:00:00Z");
const ON = { enabled: true, acknowledgedTerms: "2026-10-11", acknowledgedConditions: PERSON_CONDITIONS.map((c) => c.id) };
const HTTP = {
  enabled: true,
  label: "acme-ids",
  url: "https://api.supplier.example/v1/resolve",
  method: "POST",
  authHeader: "X-Api-Key",
  authEnv: "SUPPLIER_KEY",
  authPrefix: "",
  priceUsd: 0.5,
  request: { fields: { ip: "client_ip", userAgent: "ua", visitorId: "vid", pageUrl: "page", timestamp: "seen_at", emailSha256: "known_email_sha256" }, static: { api_version: "2" } },
  response: {
    matchesPath: "data.matches",
    fields: { emailSha256: "hashed_email.sha256", emailMd5: "hashed_email.md5", name: "full_name", workEmail: "business_email", linkedinUrl: "linkedin", title: "job_title", company: "company_name", companyDomain: "company_domain", confidence: "score" },
    confidenceScale: 100,
  },
};
const cfg = (person: Record<string, unknown> = {}): RevealConfig => ConfigSchema.parse({ personLevel: { ...ON, ...person } });

const sig = (over: Partial<VisitSignals> = {}): VisitSignals => ({ ip: "203.0.113.9", userAgent: "Mozilla/5.0 test", path: "/pricing", origin: "https://www.site.example", visitorId: "vid-1", gpc: false, dnt: false, personConsent: true, country: "US", ...over });

const supplierBody = (over: Record<string, unknown> = {}) => ({
  data: { matches: [{ hashed_email: { sha256: sha256Email("grace@example.org"), md5: md5Email("grace@example.org") }, full_name: "Grace Sample", business_email: "grace@example.org", linkedin: "https://www.linkedin.com/in/grace-sample", job_title: "VP Sales", company_name: "Sample Co", company_domain: "sample.example", score: 87, ...over }] },
});
const okFetch = (body: unknown = supplierBody()) => vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
const pdlBody = { status: 200, likelihood: 9, data: { full_name: "Ada Example", job_title: "Head of Growth", job_company_name: "Example Works", job_company_website: "exampleworks.example", linkedin_url: "linkedin.com/in/ada-example" } };
const looot = (geo = "US"): LoootRunner & { runAndWait: ReturnType<typeof vi.fn> } => ({
  runAndWait: vi.fn(async (e: string) => {
    if (e === "ipinfo-lite") return { runId: "g", status: "completed", actualCost: 0, result: { ip: "203.0.113.9", country: "US".replace("US", geo), as_name: "Net" } };
    if (e === "people-data-labs-person-enrich") return { runId: "p", status: "completed", actualCost: 0.28, result: pdlBody };
    return { runId: "x", status: "failed", error: { code: "unknown", message: "no" } };
  }),
});
const deps = (over: Record<string, unknown> = {}) => ({ looot: null, fetch: okFetch() as unknown as typeof fetch, env: { SUPPLIER_KEY: "s3cret" }, now: NOW, capMicros: 1_000_000, ...over });

describe("disabled", () => {
  it("calls nothing and stores nothing, even when the request carries person signals", async () => {
    const state = emptyState();
    const f = okFetch();
    const l = looot();
    const config = ConfigSchema.parse({ personLevel: { http: HTTP } });
    const r = queuePersonVisit(state, config, sig({ emailHash: sha256Email("a@example.org") }), NOW);
    expect(r).toEqual({ queued: false, reason: "disabled" });
    const run = await runPersonLookups(state, config, deps({ fetch: f, looot: l }));
    expect(run).toMatchObject({ spentMicros: 0, identified: 0 });
    expect(f).not.toHaveBeenCalled();
    expect(l.runAndWait).not.toHaveBeenCalled();
    expect(state.person).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain("person");
  });
});

describe("signals", () => {
  it("skips on GPC and records that it skipped, with no address", () => {
    const state = emptyState();
    const r = queuePersonVisit(state, cfg(), sig({ gpc: true }), NOW);
    expect(r).toEqual({ queued: false, reason: "gpc" });
    expect(state.person!.pending).toEqual([]);
    expect(state.person!.audit).toHaveLength(1);
    expect(state.person!.audit[0]).toMatchObject({ kind: "skipped", outcome: "gpc" });
    expect(JSON.stringify(state.person)).not.toContain("203.0.113.9");
  });
  it("skips on DNT", () => {
    const state = emptyState();
    expect(queuePersonVisit(state, cfg(), sig({ dnt: true }), NOW).reason).toBe("dnt");
    expect(state.person!.audit[0].outcome).toBe("dnt");
  });
  it("waits for consent when the gate is on, and records it", () => {
    const state = emptyState();
    expect(queuePersonVisit(state, cfg(), sig({ personConsent: false }), NOW).reason).toBe("no_consent");
    expect(state.person!.pending).toHaveLength(0);
    expect(state.person!.audit[0]).toMatchObject({ kind: "skipped", outcome: "no_consent" });
  });
  it("queues without a consent signal when the gate is off", () => {
    const state = emptyState();
    expect(queuePersonVisit(state, cfg({ requireConsent: false }), sig({ personConsent: false }), NOW).queued).toBe(true);
  });
  it("drops an EU visitor at once and never stores the address", () => {
    const state = emptyState();
    const r = queuePersonVisit(state, cfg(), sig({ country: "DE" }), NOW);
    expect(r).toEqual({ queued: false, reason: "blocked_region" });
    expect(JSON.stringify(state)).not.toContain("203.0.113.9");
  });
});

describe("region gate at run time", () => {
  it("checks an unknown country through the free IPinfo Lite call, then skips a non-US address without calling the supplier", async () => {
    const state = emptyState();
    const config = cfg({ http: HTTP });
    queuePersonVisit(state, config, sig({ country: undefined }), NOW);
    expect(state.person!.pending).toHaveLength(1);
    const f = okFetch();
    const l = looot("GB");
    const r = await runPersonLookups(state, config, deps({ fetch: f, looot: l }));
    expect(l.runAndWait).toHaveBeenCalledWith("ipinfo-lite", { ip: "203.0.113.9" }, expect.any(String), expect.anything());
    expect(f).not.toHaveBeenCalled();
    expect(r).toMatchObject({ identified: 0, skipped: 1 });
    expect(state.person!.pending).toHaveLength(0);
    expect(state.person!.audit.at(-1)).toMatchObject({ kind: "skipped", outcome: "blocked_region" });
    expect(JSON.stringify(state)).not.toContain("203.0.113.9");
  });
  it("fails closed when the country cannot be found", async () => {
    const state = emptyState();
    const config = cfg({ http: HTTP });
    queuePersonVisit(state, config, sig({ country: undefined }), NOW);
    const f = okFetch();
    const r = await runPersonLookups(state, config, deps({ fetch: f, looot: null }));
    expect(f).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
    expect(state.person!.audit.at(-1)).toMatchObject({ outcome: "region_unknown" });
  });
});

describe("http adapter", () => {
  it("sends the mapped fields with the key from the environment and maps the answer", async () => {
    const state = emptyState();
    const config = cfg({ http: HTTP });
    queuePersonVisit(state, config, sig(), NOW);
    const f = okFetch();
    const r = await runPersonLookups(state, config, deps({ fetch: f }));
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.supplier.example/v1/resolve");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("s3cret");
    expect(JSON.parse(init.body as string)).toEqual({ client_ip: "203.0.113.9", ua: "Mozilla/5.0 test", vid: "vid-1", page: "https://www.site.example/pricing", seen_at: NOW.toISOString(), api_version: "2" });
    expect(r).toMatchObject({ identified: 1, spentMicros: 500_000 });
    const p = Object.values(state.person!.people)[0];
    expect(p).toMatchObject({ name: "Grace Sample", title: "VP Sales", company: "Sample Co", companyDomain: "sample.example", linkedinUrl: "https://www.linkedin.com/in/grace-sample", supplier: "acme-ids", costMicros: 500_000, confidence: 0.87, emailSha256: sha256Email("grace@example.org") });
  });
  it("stores a hash, not the work email, unless storeWorkEmail is on", async () => {
    const state = emptyState();
    const config = cfg({ http: HTTP });
    queuePersonVisit(state, config, sig(), NOW);
    await runPersonLookups(state, config, deps());
    expect(JSON.stringify(state)).not.toContain("grace@example.org");
    expect(Object.values(state.person!.people)[0].workEmail).toBeUndefined();

    const state2 = emptyState();
    const config2 = cfg({ http: HTTP, storeWorkEmail: true });
    queuePersonVisit(state2, config2, sig(), NOW);
    await runPersonLookups(state2, config2, deps());
    expect(Object.values(state2.person!.people)[0].workEmail).toBe("grace@example.org");
  });
  it("never keeps the raw address after the attempt, and never stores the key value", async () => {
    const state = emptyState();
    const config = cfg({ http: HTTP });
    queuePersonVisit(state, config, sig(), NOW);
    await runPersonLookups(state, config, deps());
    expect(state.person!.pending).toEqual([]);
    const text = JSON.stringify(state);
    expect(text).not.toContain("203.0.113.9");
    expect(text).not.toContain("s3cret");
  });
  it("records a no-match and a failure without storing a person", async () => {
    for (const make of [() => okFetch({ data: { matches: [] } }), () => vi.fn(async () => new Response("nope", { status: 500 }))]) {
      const state = emptyState();
      const config = cfg({ http: HTTP });
      queuePersonVisit(state, config, sig(), NOW);
      const r = await runPersonLookups(state, config, deps({ fetch: make() as unknown as typeof fetch }));
      expect(r.identified).toBe(0);
      expect(Object.keys(state.person!.people)).toEqual([]);
      expect(state.person!.audit.at(-1)).toMatchObject({ kind: "lookup", supplier: "acme-ids" });
    }
  });
  it("does not call the supplier when the key env var is missing", async () => {
    const state = emptyState();
    const config = cfg({ http: HTTP });
    queuePersonVisit(state, config, sig(), NOW);
    const f = okFetch();
    await runPersonLookups(state, config, deps({ fetch: f, env: {} }));
    expect(f).not.toHaveBeenCalled();
    expect(state.person!.audit.at(-1)?.outcome).toBe("failed");
  });
});

describe("known visitor", () => {
  const ADA = sha256Email("ada@example.com");
  it("identifies from a hash the site already holds, with no third party", async () => {
    const state = emptyState();
    const config = cfg({ http: HTTP });
    queuePersonVisit(state, config, sig({ emailHash: ADA }), NOW);
    const f = okFetch();
    const l = looot();
    const r = await runPersonLookups(state, config, deps({ fetch: f, looot: l }));
    expect(f).not.toHaveBeenCalled();
    expect(r).toMatchObject({ identified: 1, spentMicros: 0 });
    expect(Object.values(state.person!.people)[0]).toMatchObject({ emailSha256: ADA, supplier: "known-visitor", costMicros: 0 });
  });
  it("links a later visit by the same first-party id", async () => {
    const state = emptyState();
    const config = cfg({ http: HTTP });
    queuePersonVisit(state, config, sig({ emailHash: ADA, path: "/signup" }), NOW);
    await runPersonLookups(state, config, deps());
    const later = new Date(NOW.getTime() + 86_400_000);
    queuePersonVisit(state, config, sig({ path: "/pricing" }), later);
    const f = okFetch();
    await runPersonLookups(state, config, deps({ fetch: f, now: later }));
    expect(f).not.toHaveBeenCalled();
    const people = Object.values(state.person!.people);
    expect(people).toHaveLength(1);
    expect(people[0].visits.map((v) => v.path)).toEqual(["/signup", "/pricing"]);
    expect(people[0].lastSeen).toBe(later.toISOString());
    expect(JSON.stringify(state)).not.toContain("vid-1");
  });
  it("is skipped when knownVisitor is turned off", () => {
    const state = emptyState();
    const config = cfg({ knownVisitor: { enabled: false } });
    queuePersonVisit(state, config, sig({ emailHash: ADA }), NOW);
    expect(state.person!.pending[0].emailHash).toBeUndefined();
  });
  it("rejects a value that is not a hash", () => {
    const state = emptyState();
    queuePersonVisit(state, cfg(), sig({ emailHash: "ada@example.com" }), NOW);
    expect(state.person!.pending[0].emailHash).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain("ada@example.com");
  });
});

describe("enrichment through looot", () => {
  const ADA = sha256Email("ada@example.com");
  const enrich = { enabled: true, endpointId: "people-data-labs-person-enrich", priceUsd: 0.28 };
  it("sends email_hash to People Data Labs person enrich and fills name, title and LinkedIn", async () => {
    const state = emptyState();
    const config = cfg({ enrich });
    queuePersonVisit(state, config, sig({ emailHash: ADA }), NOW);
    const l = looot();
    const r = await runPersonLookups(state, config, deps({ looot: l }));
    const call = l.runAndWait.mock.calls.find((c) => c[0] === "people-data-labs-person-enrich")!;
    expect(call[1]).toMatchObject({ email_hash: ADA });
    expect(call[2]).toEqual(expect.stringContaining("reveal:person.enrich:"));
    expect(r).toMatchObject({ identified: 1, spentMicros: 280_000 });
    expect(Object.values(state.person!.people)[0]).toMatchObject({ name: "Ada Example", title: "Head of Growth", company: "Example Works", companyDomain: "exampleworks.example", linkedinUrl: "linkedin.com/in/ada-example", costMicros: 280_000, supplier: "known-visitor+people-data-labs-person-enrich" });
    expect(state.calls.at(-1)).toMatchObject({ job: "person.enrich", costMicros: 280_000 });
  });
  it("shows the quote before any call, and the cap stops the enrichment", async () => {
    const state = emptyState();
    const config = cfg({ enrich });
    queuePersonVisit(state, config, sig({ emailHash: ADA }), NOW);
    queuePersonVisit(state, config, sig({ ip: "203.0.113.10", visitorId: "vid-2", emailHash: sha256Email("b@example.com") }), NOW);
    const q = quotePersonRun(state, config, 300_000);
    expect(q.pending).toBe(2);
    expect(q.lines).toEqual([expect.objectContaining({ label: expect.stringContaining("People Data Labs"), calls: 2, priceMicros: 280_000 })]);
    expect(q).toMatchObject({ maxMicros: 560_000, capBinds: true });
    const l = looot();
    const r = await runPersonLookups(state, config, deps({ looot: l, capMicros: 300_000 }));
    expect(l.runAndWait.mock.calls.filter((c) => c[0] === "people-data-labs-person-enrich")).toHaveLength(1);
    expect(r.spentMicros).toBe(280_000);
    expect(r.notRun).toBe(1);
  });
  it("uses the hash from the supplier when it returned one without a name", async () => {
    const state = emptyState();
    const config = cfg({ http: { ...HTTP, response: { ...HTTP.response, fields: { emailSha256: "hashed_email.sha256" } } }, enrich });
    queuePersonVisit(state, config, sig(), NOW);
    const l = looot();
    await runPersonLookups(state, config, deps({ looot: l }));
    const call = l.runAndWait.mock.calls.find((c) => c[0] === "people-data-labs-person-enrich")!;
    expect(call[1]).toMatchObject({ email_hash: sha256Email("grace@example.org") });
    expect(Object.values(state.person!.people)[0].name).toBe("Ada Example");
  });
});

describe("spend cap", () => {
  it("stops before a supplier call that would pass the cap and keeps the rest pending", async () => {
    const state = emptyState();
    const config = cfg({ http: HTTP });
    queuePersonVisit(state, config, sig(), NOW);
    queuePersonVisit(state, config, sig({ ip: "203.0.113.20", visitorId: "vid-2" }), NOW);
    const f = okFetch();
    const r = await runPersonLookups(state, config, deps({ fetch: f, capMicros: 600_000 }));
    expect(f).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ identified: 1, notRun: 1, spentMicros: 500_000 });
    expect(state.person!.pending).toHaveLength(1);
    expect(state.person!.audit.at(-1)).toMatchObject({ outcome: "cap_reached" });
  });
});

describe("audit log", () => {
  it("records when, which supplier, why it was allowed and what it cost", async () => {
    const state = emptyState();
    const config = cfg({ http: HTTP });
    queuePersonVisit(state, config, sig(), NOW);
    await runPersonLookups(state, config, deps());
    const a = state.person!.audit.find((e) => e.kind === "lookup")!;
    expect(a).toMatchObject({ at: NOW.toISOString(), supplier: "acme-ids", outcome: "identified", costMicros: 500_000, country: "US" });
    expect(a.why).toContain("US");
    expect(a.why.toLowerCase()).toContain("consent");
    expect(a.why).toContain("2026-10-11");
  });
});

describe("suppression and opt-out", () => {
  it("skips a visit that carries a suppressed hash", () => {
    const state = emptyState();
    const config = cfg();
    importSuppression(state, "ada@example.com", NOW);
    const r = queuePersonVisit(state, config, sig({ emailHash: sha256Email("ada@example.com") }), NOW);
    expect(r).toEqual({ queued: false, reason: "suppressed" });
    expect(state.person!.audit.at(-1)).toMatchObject({ kind: "skipped", outcome: "suppressed" });
  });
  it("discards a supplier answer whose hash, md5 or domain is suppressed, and stores nothing", async () => {
    for (const entry of [sha256Email("grace@example.org"), md5Email("grace@example.org"), "sample.example", "grace@example.org"]) {
      const state = emptyState();
      const config = cfg({ http: HTTP });
      importSuppression(state, entry, NOW);
      queuePersonVisit(state, config, sig(), NOW);
      const r = await runPersonLookups(state, config, deps());
      expect(r.identified).toBe(0);
      expect(Object.keys(state.person!.people)).toEqual([]);
      expect(state.person!.audit.at(-1)).toMatchObject({ kind: "lookup", outcome: "suppressed" });
    }
  });
  it("imports emails, sha256, md5 and domains and counts them", () => {
    const state = emptyState();
    const r = importSuppression(state, `a@example.com, ${sha256Email("b@example.com")}\n${md5Email("c@example.com")}\ncorp.example\nnot a thing`, NOW);
    expect(r).toMatchObject({ added: 5, skipped: 1 });
    const text = JSON.stringify(state.person!.suppression);
    expect(text).not.toContain("a@example.com");
    expect(state.person!.suppression.filter((e) => e.kind === "domain").map((e) => e.value)).toEqual(["corp.example"]);
  });
  it("opt-out suppresses the hash and deletes everything stored for it", async () => {
    const state = emptyState();
    const config = cfg({ http: HTTP, storeWorkEmail: true });
    queuePersonVisit(state, config, sig({ emailHash: sha256Email("grace@example.org") }), NOW);
    await runPersonLookups(state, config, deps());
    expect(Object.keys(state.person!.people)).toHaveLength(1);
    const personId = Object.keys(state.person!.people)[0];
    const r = optOutEmail(state, `  ${"Grace"}@${"Example.org"} `, NOW);
    expect(r).toMatchObject({ people: 1 });
    expect(state.person!.people).toEqual({});
    expect(state.person!.known).toEqual({});
    expect(state.person!.suppression.map((e) => e.kind).sort()).toEqual(["md5", "sha256"]);
    expect(JSON.stringify(state.person!.audit)).not.toContain(personId);
    expect(state.person!.audit.at(-1)).toMatchObject({ kind: "optout" });
    // The same person coming back is skipped.
    expect(queuePersonVisit(state, config, sig({ emailHash: sha256Email("grace@example.org") }), NOW).reason).toBe("suppressed");
  });
  it("opt-out works even when person-level was never enabled", () => {
    const state = emptyState();
    expect(() => optOutEmail(state, "x@example.com", NOW)).not.toThrow();
    expect(state.person!.suppression).toHaveLength(2);
  });
  it("delete-by-email removes the data and can leave the suppression list alone", async () => {
    const state = emptyState();
    const config = cfg({ http: HTTP });
    queuePersonVisit(state, config, sig({ emailHash: sha256Email("grace@example.org") }), NOW);
    await runPersonLookups(state, config, deps());
    const r = deleteByEmail(state, "grace@example.org", { suppress: false }, NOW);
    expect(r.people).toBe(1);
    expect(state.person!.people).toEqual({});
    expect(state.person!.suppression).toEqual([]);
    expect(state.person!.audit.at(-1)).toMatchObject({ kind: "delete" });
  });
  it("drops queued lookups that carry the hash", () => {
    const state = emptyState();
    queuePersonVisit(state, cfg(), sig({ emailHash: sha256Email("grace@example.org") }), NOW);
    expect(state.person!.pending).toHaveLength(1);
    optOutEmail(state, "grace@example.org", NOW);
    expect(state.person!.pending).toHaveLength(0);
  });
});

describe("retention", () => {
  it("deletes people, links, stale queued addresses and old audit rows", async () => {
    const state = emptyState();
    const config = cfg({ http: HTTP, retentionDays: 30, auditRetentionDays: 90 });
    queuePersonVisit(state, config, sig({ emailHash: sha256Email("ada@example.com") }), NOW);
    await runPersonLookups(state, config, deps());
    queuePersonVisit(state, config, sig({ ip: "203.0.113.50", visitorId: "vid-9" }), NOW);
    const later = new Date(NOW.getTime() + 31 * 86_400_000);
    const r = purgePerson(state, config, later);
    expect(r).toMatchObject({ people: 1, pending: 1 });
    expect(state.person!.people).toEqual({});
    expect(state.person!.known).toEqual({});
    expect(state.person!.pending).toEqual([]);
    expect(state.person!.audit.length).toBeGreaterThan(0);
    const much = new Date(NOW.getTime() + 91 * 86_400_000);
    purgePerson(state, config, much);
    expect(state.person!.audit).toEqual([]);
  });
  it("keeps a person seen inside the window", async () => {
    const state = emptyState();
    const config = cfg({ retentionDays: 30 });
    queuePersonVisit(state, config, sig({ emailHash: sha256Email("ada@example.com") }), NOW);
    await runPersonLookups(state, config, deps());
    purgePerson(state, config, new Date(NOW.getTime() + 10 * 86_400_000));
    expect(Object.keys(state.person!.people)).toHaveLength(1);
  });
  it("still deletes after the feature is switched off", async () => {
    const state = emptyState();
    const on = cfg();
    queuePersonVisit(state, on, sig({ emailHash: sha256Email("ada@example.com") }), NOW);
    await runPersonLookups(state, on, deps());
    const off = ConfigSchema.parse({ personLevel: { enabled: false, retentionDays: 30 } });
    purgePerson(state, off, new Date(NOW.getTime() + 40 * 86_400_000));
    expect(state.person!.people).toEqual({});
  });
});
