import { Link } from "wouter";
import { ChevronRight, MapPin, Activity, Shield, Users, BookOpen, Newspaper, Calendar, CheckCircle2, Menu, X } from "lucide-react";
import { useState } from "react";
import { useBranding } from "@/contexts/BrandingContext";

const NAV_LINKS = [
  { href: "/about",       label: "About" },
  { href: "/manifesto",   label: "Manifesto" },
  { href: "/news",        label: "News" },
  { href: "/events",      label: "Events" },
  { href: "/faq",         label: "FAQ" },
  { href: "/fact-check",  label: "Fact Check" },
];

export default function Home() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const branding = useBranding();
  const nameParts = branding.candidateName.toUpperCase().split(" ");
  const logoLine1 = nameParts[0] ?? "";
  const logoLine2 = nameParts.slice(1).join(" ");

  return (
    <div className="min-h-[100dvh] flex flex-col bg-white selection:bg-primary selection:text-white">
      {/* Top announcement bar */}
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
        {/* Logo */}
        <Link href="/" className="flex flex-col leading-none">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt={branding.campaignName} className="h-8 object-contain" />
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

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-6">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-xs font-bold tracking-widest uppercase text-foreground hover:text-primary transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Right actions */}
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
          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="lg:hidden p-2 text-black"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Mobile nav drawer */}
      {mobileOpen && (
        <div className="lg:hidden bg-white border-b border-gray-100 px-6 py-4 z-10 flex flex-col gap-3">
          {NAV_LINKS.map((l) => (
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
            <Link href="/sign-in" className="flex-1 text-center text-sm font-bold py-2.5 border border-black hover:bg-black hover:text-white transition-colors">
              Sign In
            </Link>
            <Link href="/crowdfunding" className="flex-1 text-center text-sm font-bold py-2.5 bg-primary text-white hover:bg-primary/90 transition-colors">
              Support
            </Link>
          </div>
        </div>
      )}

      {/* Hero Section */}
      <main className="flex-1 flex flex-col">
        <div className="flex-1 flex flex-col lg:flex-row items-center max-w-7xl mx-auto w-full px-6 py-16 lg:py-24 gap-12 lg:gap-20">
          {/* Left: Headline */}
          <div className="flex-1 flex flex-col gap-6">
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tighter text-black leading-[1.0] uppercase">
              {branding.tagline}
            </h1>
            <p className="text-lg text-gray-600 max-w-xl leading-relaxed">
              A new Kenya is possible. Read the plan, join the movement, and make your voice count.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mt-4">
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
            {/* Quick portal links */}
            <div className="flex flex-wrap gap-3 mt-2">
              {[
                { href: "/news",              label: "Latest News" },
                { href: "/events",            label: "Upcoming Events" },
                { href: "/fact-check",        label: "Fact Check" },
                { href: "/about",             label: "About Linda" },
                { href: "/aspirants-directory", label: "View Aspirants" },
                { href: "/aspirant-register",  label: "Declare Interest" },
              ].map((l) => (
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

          {/* Right: Counter card */}
          <div className="w-full max-w-sm lg:max-w-xs">
            <div className="border-4 border-black p-8 bg-white relative">
              <div className="absolute -top-2 -right-2 w-6 h-6 bg-primary" />
              <p className="font-black text-lg tracking-[0.15em] uppercase mb-4 text-black">
                Kwani Tuko Wangapi?
              </p>
              <p className="text-6xl font-black text-primary tabular-nums mb-2">
                53,508
              </p>
              <p className="text-gray-500 text-sm mb-6">
                people have joined so far
              </p>
              <Link
                href="/supporter-register"
                className="block w-full bg-primary text-white text-center py-3.5 font-black tracking-widest uppercase text-sm hover:bg-primary/90 transition-colors"
              >
                COUNT ME IN
              </Link>
            </div>
          </div>
        </div>

        {/* Political communications strip */}
        <div className="bg-black text-white py-12 px-6">
          <div className="max-w-7xl mx-auto">
            <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-3">
              The Plan for Kenya
            </p>
            <h2 className="text-3xl font-black uppercase tracking-tight mb-10">
              Political Communications
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                {
                  icon: BookOpen,
                  title: "The Manifesto",
                  desc: "20 policy sectors. Hundreds of specific, costed commitments for every Kenyan.",
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
                  desc: "Rallies, town halls, and public forums near you across all 47 counties.",
                  href: "/events",
                  cta: "See all events",
                },
                {
                  icon: CheckCircle2,
                  title: "Fact Check",
                  desc: "We hold ourselves and our opponents to the truth. Claims verified.",
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
                  <h3 className="font-black text-base uppercase tracking-tight mb-2">{title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed mb-4">{desc}</p>
                  <span className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1 group-hover:gap-2 transition-all">
                    {cta} <ChevronRight className="w-3 h-3" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* M-Pesa donation bar */}
        <div className="bg-gray-50 border-y border-gray-200 py-4 px-6 flex flex-col sm:flex-row items-center gap-4 justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-[#4CAF50] text-white text-xs font-bold px-3 py-1.5 rounded">
              LIPA NA M-PESA
            </div>
            <div className="text-sm">
              <span className="font-semibold text-gray-500 uppercase tracking-wider text-xs">Paybill</span>
              <div className="font-black text-black text-lg tracking-widest">3033049</div>
            </div>
            <div className="text-sm text-gray-400">
              Account Number: <span className="text-black font-semibold">Your M-Pesa phone number</span>
            </div>
          </div>
          <Link
            href="/crowdfunding"
            className="bg-primary text-white hover:bg-primary/90 px-6 py-3 font-bold text-sm tracking-wider uppercase transition-colors whitespace-nowrap flex items-center gap-2"
          >
            Contribute Securely <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Footer */}
        <footer className="bg-black text-white py-8 px-6">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex flex-col leading-none">
              {branding.logoUrl ? (
                <img src={branding.logoUrl} alt={branding.campaignName} className="h-6 object-contain brightness-0 invert" />
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
              {NAV_LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="text-gray-400 text-xs hover:text-white transition-colors">
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
