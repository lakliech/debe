/**
 * DebeHome — Debe platform landing page.
 * Shown on the base domain when no tenant subdomain is active.
 * Debe is the end-to-end platform a candidate uses to manage their whole
 * election — the name nods to the ballot box, and the catchphrase
 * "Niko kwa debe" ("I'm in the ballot") is the brand voice.
 */
import { Link } from "wouter";
import { ChevronRight, LayoutDashboard, Smartphone, Eye, Globe, CheckCircle, Menu, X, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";

const PLATFORM_NAV = [
  { href: "#features",    label: "Features" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "/request-access", label: "Contact" },
];

const DEMO_URL = "https://demo.debe.ke";

const DEMO_CREDENTIALS = [
  { role: "Campaign Admin",     email: "admin@demo.debe.ke",  password: "Demo@2027!" },
  { role: "County Coordinator", email: "coord@demo.debe.ke",  password: "Demo@2027!" },
  { role: "Field Agent",        email: "agent@demo.debe.ke",  password: "Demo@2027!" },
];

/** Simple ballot-box SVG illustration for the hero. */
function BallotBoxIllustration() {
  return (
    <svg
      viewBox="0 0 280 320"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full max-w-[280px] drop-shadow-2xl"
      aria-hidden="true"
    >
      {/* Box body */}
      <rect x="20" y="110" width="240" height="190" rx="8" fill="#0f172a" />
      {/* Box lid */}
      <rect x="10" y="88" width="260" height="36" rx="6" fill="#1e293b" />
      {/* Ballot slot */}
      <rect x="110" y="100" width="60" height="8" rx="4" fill="#334155" />
      {/* Ballot paper being inserted */}
      <rect x="120" y="60" width="40" height="52" rx="3" fill="white" />
      {/* Check lines on ballot */}
      <line x1="128" y1="74" x2="152" y2="74" stroke="#e2e8f0" strokeWidth="2" strokeLinecap="round" />
      <line x1="128" y1="82" x2="148" y2="82" stroke="#e2e8f0" strokeWidth="2" strokeLinecap="round" />
      {/* Checkmark accent */}
      <polyline points="128,91 134,97 152,79" stroke="hsl(var(--primary, 209 88% 50%))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Lock icon on box */}
      <rect x="125" y="178" width="30" height="26" rx="4" fill="#334155" />
      <path d="M131 178 v-7 a9 9 0 0 1 18 0 v7" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <circle cx="140" cy="191" r="3" fill="#94a3b8" />
      {/* Kenya flag colours as stripe */}
      <rect x="20" y="270" width="240" height="10" rx="0" fill="#006600" />
      <rect x="20" y="280" width="240" height="10" rx="0" fill="#CC0001" />
      <rect x="20" y="290" width="240" height="10" rx="0" fill="#000000" />
      {/* Decorative corner accent */}
      <rect x="230" y="100" width="16" height="16" fill="hsl(var(--primary, 209 88% 50%))" />
    </svg>
  );
}

const FEATURES = [
  {
    icon: LayoutDashboard,
    title: "Campaign HQ",
    desc: "A full-featured admin portal for each campaign. Manage agents, track declarations, publish content, and configure your branded public portal — all from one dashboard.",
  },
  {
    icon: Smartphone,
    title: "Field Agent App",
    desc: "An offline-capable mobile app for ground agents. Capture Form 34A results, sync photos, and submit reports — even without a stable data connection.",
  },
  {
    icon: Eye,
    title: "Results Transparency",
    desc: "A public portal where any citizen can verify Form 34A results and photos submitted from polling stations, building trust in the electoral process.",
  },
  {
    icon: Globe,
    title: "Multi-Tenant Portals",
    desc: "Every campaign on Debe gets its own branded portal — custom logo, colours, and domain. Completely isolated data means no campaign ever sees another's information.",
  },
];

const STEPS = [
  {
    number: "01",
    title: "Register Your Campaign",
    desc: "Contact us to provision a Debe tenant. Your campaign gets an isolated environment with its own branded subdomain in minutes.",
  },
  {
    number: "02",
    title: "Configure & Onboard",
    desc: "Upload your logo and colours, add your candidate details, and invite your campaign coordinators and field agents.",
  },
  {
    number: "03",
    title: "Deploy on Election Day",
    desc: "Your agents use the mobile app to submit results in the field. Coordinators review in real time. The public verifies results on your portal.",
  },
];

/** Animated demo credentials card shown when "Try Demo" is clicked. */
function DemoCredentialsCard({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1800);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-label="Demo credentials"
      >
        {/* Card header */}
        <div className="bg-slate-950 px-6 py-5 flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 bg-primary/20 border border-primary/30 px-2.5 py-0.5 text-[10px] font-black tracking-[0.2em] uppercase text-primary mb-2">
              Live Demo
            </div>
            <h2 className="text-white font-black text-lg uppercase tracking-tight leading-tight">
              Try Debe — Read-only
            </h2>
            <p className="text-slate-400 text-xs mt-1 leading-relaxed">
              Pre-seeded campaign environment. All writes are blocked.
              Resets nightly.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors mt-0.5 flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Credentials rows */}
        <div className="divide-y divide-gray-100">
          {DEMO_CREDENTIALS.map(({ role, email, password }) => (
            <div key={role} className="px-6 py-4">
              <p className="text-[10px] font-black tracking-[0.18em] uppercase text-gray-400 mb-2">
                {role}
              </p>
              <div className="flex flex-col gap-1.5">
                {/* Email row */}
                <div className="flex items-center gap-2">
                  <span className="flex-1 font-mono text-sm text-slate-800 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-sm truncate">
                    {email}
                  </span>
                  <button
                    onClick={() => copy(email, `email-${role}`)}
                    className="text-slate-400 hover:text-primary transition-colors p-1.5"
                    aria-label={`Copy email for ${role}`}
                  >
                    {copied === `email-${role}` ? (
                      <span className="text-[10px] font-bold text-primary">✓</span>
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                {/* Password row */}
                <div className="flex items-center gap-2">
                  <span className="flex-1 font-mono text-sm text-slate-800 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-sm">
                    {password}
                  </span>
                  <button
                    onClick={() => copy(password, `pw-${role}`)}
                    className="text-slate-400 hover:text-primary transition-colors p-1.5"
                    aria-label={`Copy password for ${role}`}
                  >
                    {copied === `pw-${role}` ? (
                      <span className="text-[10px] font-bold text-primary">✓</span>
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Open demo button */}
        <div className="px-6 py-5 border-t border-gray-100 bg-slate-50 space-y-3">
          {/*
            The guided tour is the fastest route into the product — no account,
            no credentials to copy — so it leads. The logins below stay for
            anyone who wants to see a specific role's view.
          */}
          <Link
            href="/?demo=1"
            className="flex items-center justify-center gap-2 bg-primary text-white font-black text-sm tracking-widest uppercase px-6 py-3.5 hover:bg-primary/90 transition-colors w-full"
          >
            Try a live demo
            <ChevronRight className="w-4 h-4" />
          </Link>
          <p className="text-center text-[11px] text-slate-500">
            Signs you straight in, read-only, with a 6-step guided tour.
          </p>
          <a
            href={DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 border border-slate-300 text-slate-700 font-bold text-xs tracking-widest uppercase px-6 py-3 hover:bg-white transition-colors w-full"
          >
            Sign in with a demo login
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}

export default function DebeHome() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showDemo, setShowDemo] = useState(false);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-white selection:bg-primary selection:text-white">

      {showDemo && <DemoCredentialsCard onClose={() => setShowDemo(false)} />}

      {/* Top bar */}
      <div className="bg-primary text-white text-xs sm:text-sm text-center py-2.5 px-4 font-medium tracking-wide">
        Debe is built for Kenya's 2027 general election.{" "}
        <Link href="/request-access" className="underline underline-offset-2 hover:opacity-80 transition-opacity">
          Get your campaign on the platform →
        </Link>
      </div>

      {/* Header */}
      <header className="px-6 h-16 flex items-center justify-between border-b border-gray-100 bg-white z-20 relative">
        {/* Wordmark */}
        <Link href="/" className="flex items-center gap-2 leading-none">
          <div className="bg-primary text-white font-black text-lg px-2.5 py-0.5 tracking-[0.15em]">
            DEBE
          </div>
          <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-gray-400 hidden sm:block">
            Niko kwa debe
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-8">
          {PLATFORM_NAV.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-xs font-bold tracking-widest uppercase text-foreground hover:text-primary transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/sign-in"
            className="text-sm font-bold text-foreground hover:text-primary transition-colors hidden sm:block tracking-wide"
          >
            SIGN IN
          </Link>
          <button
            onClick={() => setShowDemo(true)}
            className="border border-primary text-primary hover:bg-primary hover:text-white px-4 py-1.5 font-bold text-xs transition-all tracking-wide hidden sm:flex items-center gap-1.5"
          >
            Try Demo
            <ExternalLink className="w-3 h-3" />
          </button>
          <Link
            href="/request-access"
            className="bg-primary text-white hover:bg-primary/90 px-5 py-2 font-bold text-sm transition-all tracking-wide hidden sm:block"
          >
            GET STARTED
          </Link>
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="lg:hidden p-2 text-black"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden bg-white border-b border-gray-100 px-6 py-4 z-10 flex flex-col gap-3">
          {PLATFORM_NAV.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setMobileOpen(false)}
              className="text-sm font-bold tracking-widest uppercase text-foreground hover:text-primary transition-colors py-1"
            >
              {l.label}
            </a>
          ))}
          <div className="flex gap-3 mt-2 pt-3 border-t border-gray-100">
            <Link
              href="/sign-in"
              className="flex-1 text-center text-sm font-bold py-2.5 border border-black hover:bg-black hover:text-white transition-colors"
            >
              Sign In
            </Link>
            <button
              onClick={() => { setMobileOpen(false); setShowDemo(true); }}
              className="flex-1 text-center text-sm font-bold py-2.5 border border-primary text-primary hover:bg-primary hover:text-white transition-colors flex items-center justify-center gap-1.5"
            >
              Try Demo
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
            <Link
              href="/request-access"
              className="flex-1 text-center text-sm font-bold py-2.5 bg-primary text-white hover:bg-primary/90 transition-colors"
            >
              Get Started
            </Link>
          </div>
        </div>
      )}

      <main className="flex-1 flex flex-col">

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="bg-slate-950 text-white">
          <div className="max-w-7xl mx-auto px-6 py-20 lg:py-28 flex flex-col lg:flex-row items-center gap-16">
            {/* Copy */}
            <div className="flex-1 flex flex-col gap-7">
              <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 px-4 py-2 text-xs font-bold tracking-[0.2em] uppercase text-primary w-fit">
                Kenya 2027 General Election
              </div>
              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tighter leading-[1.0] uppercase">
                <span className="text-primary">Debe</span>
                <br />
                <span className="text-white">Your Campaign,</span>
                <br />
                <span className="text-white">End to End</span>
              </h1>
              <p className="text-sm font-bold tracking-[0.25em] uppercase text-primary">
                Niko kwa debe — I'm in the ballot
              </p>
              <p className="text-lg text-slate-300 max-w-lg leading-relaxed">
                The platform that lets a political candidate manage their entire
                election — from campaign HQ to field agents to verified results —
                in one place. Purpose-built for the realities of campaigning across
                47 counties: offline-capable, multi-tenant, and transparent by design.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 mt-2">
                <Link
                  href="/request-access"
                  className="bg-primary text-white hover:bg-primary/90 px-8 py-4 font-black text-base tracking-widest uppercase transition-all flex items-center justify-center gap-2 group"
                >
                  Get Your Campaign on Debe
                  <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Link>
                <button
                  onClick={() => setShowDemo(true)}
                  className="border border-white/40 text-white hover:bg-white/10 hover:border-white/60 px-8 py-4 font-black text-base tracking-widest uppercase transition-all flex items-center justify-center gap-2"
                >
                  Try Demo
                  <ExternalLink className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Illustration */}
            <div className="flex-shrink-0 flex items-center justify-center w-full max-w-[280px] lg:max-w-[320px]">
              <BallotBoxIllustration />
            </div>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────────────── */}
        <section id="features" className="bg-black text-white py-20 px-6">
          <div className="max-w-7xl mx-auto">
            <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-3">
              What Debe Provides
            </p>
            <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight mb-14 max-w-lg">
              Everything a modern campaign needs
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <div
                  key={title}
                  className="border border-white/15 p-7 hover:border-primary hover:bg-white/5 transition-all"
                >
                  <div className="w-12 h-12 bg-primary/15 flex items-center justify-center mb-5">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-black text-base uppercase tracking-tight mb-3">{title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── How It Works ─────────────────────────────────────────────── */}
        <section id="how-it-works" className="bg-slate-50 py-20 px-6">
          <div className="max-w-7xl mx-auto">
            <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-3">
              Simple Onboarding
            </p>
            <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight mb-14 max-w-lg text-slate-900">
              Up and running before nominations close
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
              {STEPS.map(({ number, title, desc }) => (
                <div key={number} className="flex flex-col gap-4">
                  <div className="text-6xl font-black text-primary/20 leading-none tabular-nums">
                    {number}
                  </div>
                  <h3 className="font-black text-lg uppercase tracking-tight text-slate-900">
                    {title}
                  </h3>
                  <p className="text-slate-500 leading-relaxed text-sm">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Trust strip ──────────────────────────────────────────────── */}
        <section className="bg-white border-y border-gray-100 py-10 px-6">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-8 sm:gap-16 text-center">
            {[
              { stat: "47", label: "Counties supported" },
              { stat: "100%", label: "Data isolation per campaign" },
              { stat: "Offline", label: "Field agent app" },
              { stat: "Public", label: "Results transparency portal" },
            ].map(({ stat, label }) => (
              <div key={label} className="flex flex-col items-center gap-1">
                <span className="text-3xl font-black text-primary tabular-nums">{stat}</span>
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">{label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA / Contact ─────────────────────────────────────────────── */}
        <section id="contact" className="bg-primary py-20 px-6">
          <div className="max-w-3xl mx-auto text-center flex flex-col items-center gap-8">
            <div className="flex items-center justify-center w-16 h-16 bg-white/15 rounded-full">
              <CheckCircle className="w-8 h-8 text-white" />
            </div>
            <div>
              <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-white mb-4">
                Ready to run a digital campaign?
              </h2>
              <p className="text-white/80 text-lg max-w-xl mx-auto leading-relaxed">
                Contact us to provision your campaign's Debe portal. We'll have your
                branded environment ready before your agents hit the ground.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href="/request-access"
                className="bg-white text-primary font-black text-sm tracking-widest uppercase px-8 py-4 hover:bg-white/90 transition-colors flex items-center gap-2 group"
              >
                Request Access
                <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
              <button
                onClick={() => setShowDemo(true)}
                className="border-2 border-white text-white font-black text-sm tracking-widest uppercase px-8 py-4 hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
              >
                Try Demo
                <ExternalLink className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <footer className="bg-slate-950 text-white py-10 px-6">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="bg-primary text-white font-black text-sm px-2.5 py-0.5 tracking-[0.15em]">
                DEBE
              </div>
              <span className="text-slate-500 text-xs tracking-wider uppercase">
                Niko kwa debe · I'm in the ballot
              </span>
            </div>
            <div className="flex gap-6">
              {PLATFORM_NAV.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  className="text-slate-500 text-xs hover:text-white transition-colors"
                >
                  {l.label}
                </a>
              ))}
            </div>
            <p className="text-slate-600 text-xs text-center">
              © {new Date().getFullYear()} Debe Platform · Built for Kenya
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}
