/**
 * Privacy Policy — debe.ke
 *
 * Public page (no auth). Written against the Kenya Data Protection Act, 2019
 * and honest to the implementation: Debe is the data controller for platform
 * accounts and enquiries, and a data processor for the data each campaign
 * loads into its own workspace.
 */
import { Link } from "wouter";
import { Shield } from "lucide-react";

const EFFECTIVE_DATE = "11 August 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-extrabold tracking-tight text-slate-900">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="bg-primary text-white font-black text-sm px-2.5 py-0.5 tracking-[0.15em]">
              DEBE
            </div>
            <span className="text-slate-500 text-xs tracking-wider uppercase hidden sm:inline">
              Niko kwa debe · I'm in the ballot
            </span>
          </Link>
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
            ← Back to debe.ke
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 space-y-10">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 border border-primary/20 rounded-sm">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Privacy Policy</h1>
          </div>
          <p className="text-sm text-slate-500">
            Effective {EFFECTIVE_DATE} · Applies to debe.ke, the Debe platform, and connected mobile apps.
          </p>
          <p className="text-sm leading-relaxed text-slate-600">
            Debe is an election operations platform for Kenyan campaigns. This policy explains what
            personal data we handle, why, how long we keep it, and the rights you have under the{" "}
            <em>Data Protection Act, 2019</em> (Kenya).
          </p>
        </div>

        <Section title="1. Who is responsible for your data">
          <p>
            <strong>Platform data.</strong> Debe is the <strong>data controller</strong> for
            information you give us directly: platform accounts, Request Access enquiries, billing
            details, and support correspondence.
          </p>
          <p>
            <strong>Campaign data.</strong> Each campaign (a "tenant") is the data controller for
            the data it loads into its own workspace — supporter lists, agent records, polling
            results, and communications. Debe processes that data <strong>on the campaign's
            instructions</strong> as a data processor. If your data is held by a campaign using
            Debe, please contact that campaign first; we will assist them in honouring your
            request.
          </p>
        </Section>

        <Section title="2. What we collect">
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong>Account data</strong> — name, email address, and authentication identifiers (managed by our identity provider, Clerk).</li>
            <li><strong>Enquiry data</strong> — name, email, organisation, and message submitted via Request Access.</li>
            <li><strong>Campaign workspace data</strong> — uploaded by campaigns: supporter contact details, agent profiles (which may include national ID numbers where a campaign chooses to collect them), polling-station results, and communication history.</li>
            <li><strong>Billing data</strong> — subscription status and invoices. Card details are handled by Stripe; we never see or store full card numbers.</li>
            <li><strong>Integration credentials</strong> — WhatsApp Business tokens, M-Pesa keys, and SMS relay tokens you connect. These are stored AES-256-GCM encrypted and are never returned by our API.</li>
            <li><strong>Usage data</strong> — audit logs of administrative actions, and standard server logs (IP address, browser, timestamps) for security and debugging.</li>
          </ul>
        </Section>

        <Section title="3. How we use it">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Provide, secure, and operate the platform (authentication, tenant isolation, backups).</li>
            <li>Respond to enquiries and provide support.</li>
            <li>Process subscriptions and billing.</li>
            <li>Send service notices (account, security, billing) — platform messages may be sent over email, SMS, or WhatsApp using the contact details on the account.</li>
            <li>Meet legal obligations, including election-law record-keeping that applies to campaign data.</li>
          </ul>
          <p>We do not sell personal data, and we do not use campaign workspace data for advertising or profiling.</p>
        </Section>

        <Section title="4. Communications and consent">
          <p>
            Campaigns may use Debe to send SMS, WhatsApp, or email to their supporters and agents.
            The campaign is responsible for having a lawful basis (including consent where required)
            for those messages, and Debe records consent status and opt-outs on the campaign's
            behalf. To stop messages from a campaign, reply STOP or contact the campaign directly.
          </p>
        </Section>

        <Section title="5. How we protect data">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Strict tenant isolation — one campaign's data is never visible to another, enforced at the database and API layers.</li>
            <li>Role-based access control within each campaign, with audit logs of privileged actions.</li>
            <li>Encryption in transit (TLS) and encryption at rest for stored secrets.</li>
            <li>A read-only demo environment that contains no real personal data.</li>
          </ul>
        </Section>

        <Section title="6. Who we share it with">
          <p>We use a small set of sub-processors, only as needed to run the service:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong>Clerk</strong> — authentication and user management.</li>
            <li><strong>Stripe</strong> — subscription billing.</li>
            <li><strong>Meta (WhatsApp Business Cloud)</strong> and our <strong>SMS relay provider</strong> — message delivery, when a channel is used.</li>
            <li><strong>Cloud hosting providers</strong> — infrastructure and backups.</li>
          </ul>
          <p>
            Where these providers process data outside Kenya, we rely on appropriate safeguards as
            required by the Data Protection Act, 2019.
          </p>
        </Section>

        <Section title="7. How long we keep it">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Account and billing records — for the life of the account plus the period required by tax and company law.</li>
            <li>Enquiries — while the lead is active, and up to 24 months after closure.</li>
            <li>Campaign workspace data — until the campaign deletes it or closes its workspace. When a campaign is deleted, data is first deactivated, then permanently purged after a grace period (about 30 days).</li>
            <li>Audit and security logs — 12 months by default (the retention period is a configurable platform setting).</li>
          </ul>
        </Section>

        <Section title="8. Your rights">
          <p>Under the Data Protection Act, 2019, you may:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Access, correct, or delete your personal data.</li>
            <li>Object to or restrict certain processing, and withdraw consent where processing is based on consent.</li>
            <li>Request a portable copy of data you provided.</li>
            <li>Complain to the Office of the Data Protection Commissioner (ODPC) at <strong>odpc.go.ke</strong>.</li>
          </ul>
          <p>
            To exercise any of these rights, email <strong>privacy@debe.ke</strong>. For data held by
            a campaign, we will route your request to that campaign and assist them in fulfilling it.
          </p>
        </Section>

        <Section title="9. Cookies">
          <p>
            We use only the cookies needed to keep you signed in and keep the service secure
            (session and authentication cookies). We do not use advertising or cross-site tracking
            cookies.
          </p>
        </Section>

        <Section title="10. Changes to this policy">
          <p>
            If we make material changes, we will update the effective date above and, for account
            holders, give notice through the platform or by email before the change takes effect.
          </p>
        </Section>

        <Section title="11. Contact">
          <p>
            Data protection enquiries: <strong>privacy@debe.ke</strong>
            <br />
            General support: <strong>support@debe.ke</strong>
          </p>
        </Section>
      </main>

      <footer className="bg-slate-950 text-white py-10 px-6 mt-8">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="bg-primary text-white font-black text-sm px-2.5 py-0.5 tracking-[0.15em]">
            DEBE
          </div>
          <p className="text-slate-600 text-xs text-center">
            © {new Date().getFullYear()} Debe Platform · Built for Kenya
          </p>
        </div>
      </footer>
    </div>
  );
}
