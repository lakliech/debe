/**
 * TenantHome — campaign-specific landing page shown on tenant subdomains.
 * All copy reads from BrandingContext; no hard-coded candidate names or amounts.
 */
import { Link } from "wouter";
import {
  ChevronRight,
  BookOpen,
  Newspaper,
  Calendar,
  CheckCircle2,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";
import { useBranding, useBrandingSuspended } from "@/contexts/BrandingContext";

const BASE_NAV = [
  { href: "/about",       label: "About" },
  { href: "/manifesto",   label: "Manifesto" },
  { href: "/news",        label: "News" },
  { href: "/events",      label: "Events" },
  { href: "/faq",         label: "FAQ" },
  { href: "/fact-check",  label: "Fact Check" },
];

export default function TenantHome() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const branding = useBranding();
  const isSuspended = useBrandingSuspended();
  const nameParts = branding.candidateName.toUpperCase().split(" ");
  const firstName = branding.candidateName.split(" ")[0] ?? branding.candidateName;

  if (isSuspended) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white px-6 text-center gap-6">
        <div className="text-8xl font-black text-gray-200 font-mono tracking-tighter select-none">
          404
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">
            Campaign Unavailable
          </h1>
          <p className="text-gray-500 max-w-sm">
            This campaign portal is currently unavailable. Please check back
            later or contact the campaign team directly.
          </p>
        </div>
      </div>
    );
  }

  const logoLine1 = nameParts[0] ?? "";
  const logoLine2 = nameParts.slice(1).join(" ");

  const quickLinks = [
    { href: "/news",               label: "Latest News" },
    { href: "/events",             label: "Upcoming Events" },
    { href: "/fact-check",         label: "Fact Check" },
    { href: "/about",              label: `About ${firstName}` },
    { href: "/aspirants-directory", label: "View Aspirants" },
    { href: "/aspirant-register",  label: "Declare Interest" },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-white selection:bg-primary selection:text-white">
      {/* Announcement bar */}
      <div className="bg-black text-white text-xs sm:text-sm text-center py-2.5 px-4 font-medium tracking-wide">
        Uko Kadi?{" "}
        <a
          href="https://www.iebc.or.ke"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-primary transition-colors"
        >
          Verify if you are a registered voter
        </a>
      </div>

      {/* Header */}
      <header className="px-6 h-16 flex items-center justify-between border-b border-gray-100 bg-white z-20 relative">
        <Link href="/" className="flex flex-col leading-none">
          {branding.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt={branding.campaignName}
              className="h-8 object-contain"
            />
          ) : (
            <>
              <div className="bg-primary text-white font-black text-sm px-2 py-0.5 tracking-wider">
                {logoLine1}
              </div>
              {logoLine2 && (
                <div className="text-black font-black text-[10px] tracking-[0.2em] mt-0.5">
                  {logoLine2}
                </div>
              )}
            </>
          )}
        </Link>

        <nav className="hidden lg:flex items-center gap-6">
          {BASE_NAV.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-xs font-bold tracking-widest uppercase text-foreground hover:text-primary transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/sign-in"
            className="text-sm font-bold text-foreground hover:text-primary transition-colors hidden sm:block tracking-wide"
          >
            SIGN IN
          </Link>
          <Link
            href="/crowdfunding"
            className="bg-primary text-white hover:bg-primary/90 px-5 py-2 font-bold text-sm transition-all tracking-wide hidden sm:block"
          >
            SUPPORT
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
          {BASE_NAV.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMobileOpen(false)}
              className="text-sm font-bold tracking-widest uppercase text-foreground hover:text-primary transition-colors py-1"
            >
              {l.label}
            </Link>
          ))}
          <div className="flex gap-3 mt-2 pt-3 border-t border-gray-100">
            <Link
              href="/sign-in"
              className="flex-1 text-center text-sm font-bold py-2.5 border border-black hover:bg-black hover:text-white transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/crowdfunding"
              className="flex-1 text-center text-sm font-bold py-2.5 bg-primary text-white hover:bg-primary/90 transition-colors"
            >
              Support
            </Link>
          </div>
        </div>
      )}

      <main className="flex-1 flex flex-col">
        {/* Hero */}
        <div className="flex-1 flex flex-col items-start max-w-7xl mx-auto w-full px-6 py-16 lg:py-24 gap-6">
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tighter text-black leading-[1.0] uppercase max-w-3xl">
            {branding.tagline}
          </h1>
          <p className="text-lg text-gray-600 max-w-xl leading-relaxed">
            Get informed, get involved, and make your voice count.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 mt-2">
            <Link
              href="/manifesto"
              className="bg-primary text-white hover:bg-primary/90 px-8 py-4 font-black text-base tracking-widest uppercase transition-all flex items-center justify-center gap-2 group"
            >
              Read the Manifesto
              <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="/volunteer-register"
              className="bg-black text-white hover:bg-black/80 px-8 py-4 font-black text-base tracking-widest uppercase transition-all flex items-center justify-center"
            >
              Volunteer
            </Link>
          </div>
          <div className="flex flex-wrap gap-3 mt-2">
            {quickLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-xs font-bold tracking-wider uppercase text-primary border border-primary/30 px-3 py-1.5 hover:bg-primary hover:text-white transition-colors"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Campaign comms strip */}
        <div className="bg-black text-white py-12 px-6">
          <div className="max-w-7xl mx-auto">
            <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-3">
              {branding.campaignName}
            </p>
            <h2 className="text-3xl font-black uppercase tracking-tight mb-10">
              Campaign Communications
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                {
                  icon: BookOpen,
                  title: "The Manifesto",
                  desc: "Specific, costed commitments across every policy area.",
                  href: "/manifesto",
                  cta: "Read the manifesto",
                },
                {
                  icon: Newspaper,
                  title: "Latest News",
                  desc: "Press releases, policy papers, campaign updates, and speeches.",
                  href: "/news",
                  cta: "Read the news",
                },
                {
                  icon: Calendar,
                  title: "Events",
                  desc: "Rallies, town halls, and public forums near you.",
                  href: "/events",
                  cta: "See all events",
                },
                {
                  icon: CheckCircle2,
                  title: "Fact Check",
                  desc: "Claims verified. Holding everyone to the truth.",
                  href: "/fact-check",
                  cta: "View fact checks",
                },
              ].map(({ icon: Icon, title, desc, href, cta }) => (
                <Link
                  key={href}
                  href={href}
                  className="border border-white/20 p-6 hover:border-primary hover:bg-white/5 transition-all group block"
                >
                  <Icon className="w-8 h-8 text-primary mb-4" />
                  <h3 className="font-black text-base uppercase tracking-tight mb-2">
                    {title}
                  </h3>
                  <p className="text-gray-400 text-sm leading-relaxed mb-4">{desc}</p>
                  <span className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1 group-hover:gap-2 transition-all">
                    {cta} <ChevronRight className="w-3 h-3" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* M-Pesa donation bar — only shown when paybill is configured */}
        {branding.mpesaPaybill && (
          <div className="bg-gray-50 border-y border-gray-200 py-4 px-6 flex flex-col sm:flex-row items-center gap-4 justify-between">
            <div className="flex items-center gap-4">
              <div className="bg-[#4CAF50] text-white text-xs font-bold px-3 py-1.5 rounded">
                LIPA NA M-PESA
              </div>
              <div className="text-sm">
                <span className="font-semibold text-gray-500 uppercase tracking-wider text-xs">
                  Paybill
                </span>
                <div className="font-black text-black text-lg tracking-widest">
                  {branding.mpesaPaybill}
                </div>
              </div>
              <div className="text-sm text-gray-400">
                Account Number:{" "}
                <span className="text-black font-semibold">
                  Your M-Pesa phone number
                </span>
              </div>
            </div>
            <Link
              href="/crowdfunding"
              className="bg-primary text-white hover:bg-primary/90 px-6 py-3 font-bold text-sm tracking-wider uppercase transition-colors whitespace-nowrap flex items-center gap-2"
            >
              Contribute Securely <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        )}

        {/* Footer */}
        <footer className="bg-black text-white py-8 px-6">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex flex-col leading-none">
              {branding.logoUrl ? (
                <img
                  src={branding.logoUrl}
                  alt={branding.campaignName}
                  className="h-6 object-contain brightness-0 invert"
                />
              ) : (
                <>
                  <div className="bg-primary text-white font-black text-xs px-1.5 py-0.5 tracking-wider inline-block">
                    {logoLine1}
                  </div>
                  {logoLine2 && (
                    <div className="text-white font-black text-[9px] tracking-[0.2em] mt-0.5">
                      {logoLine2}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
              {BASE_NAV.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="text-gray-400 text-xs hover:text-white transition-colors"
                >
                  {l.label}
                </Link>
              ))}
            </div>
            <p className="text-gray-500 text-xs text-center">
              © {branding.electionYear} {branding.candidateName}
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}
