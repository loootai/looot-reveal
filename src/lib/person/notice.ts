/** A starting paragraph for a privacy notice. It is not legal advice. Edit it with your lawyer. */
export const SAMPLE_NOTICE = `Identifying visitors to our website. If you visit our site from the United States, we may try to work out who you are, using an email address we already hold for you (for example from a form you filled in or an email we sent you) or data from an identity supplier we have a contract with, [supplier name]. We then store your name, job title, employer and a hashed form of your email address for up to [30] days, and we use it to decide whether to contact you about our services. We do not do this if your browser sends a Global Privacy Control or Do Not Track signal, if you have not agreed on our cookie banner, or if you visit from the EU, the EEA, the UK or Switzerland. To opt out and have what we hold about you deleted, use [your reveal host]/optout or write to [contact address].`;

/** The mapping the setup page and the README show for a made-up supplier. Field names are invented; use the ones in your supplier's documentation. */
export const EXAMPLE_HTTP_CONFIG = {
  enabled: true,
  label: "acme-ids",
  url: "https://api.acme-ids.example/v2/resolve",
  method: "POST",
  authHeader: "X-Api-Key",
  authEnv: "ACME_IDS_KEY",
  authPrefix: "",
  priceUsd: 0.12,
  request: {
    fields: { ip: "client_ip", userAgent: "ua", visitorId: "visitor_id", pageUrl: "page", timestamp: "seen_at" },
    static: { api_version: "2" },
  },
  response: {
    matchesPath: "data.matches",
    fields: { emailSha256: "hashed_email.sha256", emailMd5: "hashed_email.md5", name: "full_name", workEmail: "business_email", linkedinUrl: "linkedin", title: "job_title", company: "company_name", companyDomain: "company_domain", confidence: "score" },
    confidenceScale: 100,
  },
} as const;
