import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <article className="max-w-2xl space-y-4 [&_h2]:mt-6 [&_h2]:text-16 [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc">
      <h1 className="text-20 font-semibold">Privacy and consent</h1>
      <p>looot-reveal turns an IP address into a company. It does not turn anything into a person. That is a design limit, not a missing feature.</p>
      <h2>Why company-level only</h2>
      <p>An IP address is personal data under the GDPR and the UK GDPR. Matching one to a named individual needs a lawful basis, usually consent, and in the US it runs into state privacy laws such as the CCPA and CPRA. A business network address is different in practice: the lookup returns the organisation that owns the network, which is also public registry data. This tool stops there and never joins a visit to a person, an email or a social profile.</p>
      <h2>What you must do</h2>
      <ul>
        <li>In the EU, the UK and any place that requires it, show a consent banner before the snippet sends anything. The snippet waits for window.revealGrant().</li>
        <li>Describe the processing in your privacy policy, and name looot and IPinfo as processors for the IP lookup.</li>
        <li>Set a retention window you can defend. The default is 30 days.</li>
        <li>If you import server logs instead of using the snippet, your lawful basis for keeping those logs still applies.</li>
      </ul>
      <h2>What the app does for you</h2>
      <ul>
        <li>Keeps only a salted hash of each IP after it has an answer. Turn storeRawIp on only if you need raw addresses.</li>
        <li>Cuts query strings from paths before storing them, because they often carry emails and tokens.</li>
        <li>Drops consumer ISP, mobile, hosting and VPN addresses from the feed, since they are people at home or no one in particular.</li>
        <li>Deletes visits and stored answers older than retentionDays.</li>
        <li>Sends nothing from the snippet when the browser sends Global Privacy Control or Do Not Track.</li>
      </ul>
      <p className="text-mute">This page is not legal advice. Ask your counsel before you use the data for outreach.</p>
    </article>
  );
}
