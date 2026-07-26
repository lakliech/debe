import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";

interface PublicPortalLayoutProps {
  children: React.ReactNode;
}

const navLinks = [
  { href: "/about", labelEn: "About", labelSw: "Kuhusu" },
  { href: "/manifesto", labelEn: "Manifesto", labelSw: "Ilani" },
  { href: "/events", labelEn: "Events", labelSw: "Matukio" },
  { href: "/news", labelEn: "News", labelSw: "Habari" },
  { href: "/faq", labelEn: "FAQ", labelSw: "Maswali" },
  { href: "/fact-check", labelEn: "Fact Check", labelSw: "Ukweli" },
  { href: "/crowdfunding",      labelEn: "Crowdfunding",    labelSw: "Mchango" },
  { href: "/aspirants-directory", labelEn: "Aspirants",     labelSw: "Wagombea" },
  { href: "/aspirant-register",  labelEn: "Run for Office", labelSw: "Gombea" },
];

const footerLinks = [
  { href: "/about", label: "About" },
  { href: "/manifesto", label: "Manifesto" },
  { href: "/events", label: "Events" },
  { href: "/news", label: "News" },
  { href: "/faq", label: "FAQ" },
  { href: "/media", label: "Media" },
  { href: "/contact", label: "Contact" },
  { href: "/aspirants-directory", label: "Aspirants" },
  { href: "/data-request",        label: "Data Request" },
];

export default function PublicPortalLayout({ children }: PublicPortalLayoutProps) {
  const [location] = useLocation();
  const { lang, setLang, t } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex flex-col min-h-screen bg-white">
      {/* Announcement bar */}
      <div className="bg-black text-white text-xs sm:text-sm text-center py-2.5 px-4 font-medium tracking-wide">
        {t("Uko Kadi? Register to vote at IEBC", "Uko Kadi? Jisajili kupiga kura IEBC")}{" "}
        <a
          href="https://www.iebc.or.ke"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-primary transition-colors"
        >
          iebc.or.ke
        </a>
      </div>

      {/* Sticky header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex flex-col leading-none shrink-0">
            <div className="bg-primary text-white font-black text-sm px-2 py-0.5 tracking-wider">
              LINDA
            </div>
            <div className="text-black font-black text-[10px] tracking-[0.2em] mt-0.5">
              MWANANCHI
            </div>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "text-sm font-bold tracking-wide transition-colors",
                  location === link.href || location.startsWith(link.href + "/")
                    ? "text-primary"
                    : "text-foreground hover:text-primary"
                )}
              >
                {lang === "sw" ? link.labelSw : link.labelEn}
              </Link>
            ))}
          </nav>

          {/* Right controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Language toggle */}
            <button
              onClick={() => setLang(lang === "en" ? "sw" : "en")}
              className="text-xs font-black tracking-wider border border-black px-2 py-1 hover:bg-black hover:text-white transition-colors"
            >
              {lang === "en" ? "EN" : "SW"} | {lang === "en" ? "SW" : "EN"}
            </button>

            <Link
              href="/sign-in"
              className="hidden sm:block text-sm font-bold text-foreground hover:text-primary transition-colors tracking-wide"
            >
              {t("Sign In", "Ingia")}
            </Link>
            <Link
              href="/volunteer-register"
              className="bg-primary text-white hover:bg-primary/90 px-4 py-2 font-bold text-sm tracking-wide transition-colors hidden sm:block"
            >
              {t("Volunteer", "Jitolee")}
            </Link>

            {/* Mobile hamburger */}
            <button
              className="lg:hidden p-2 text-foreground"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Toggle menu"
            >
              {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {/* Mobile drawer */}
        {menuOpen && (
          <div className="lg:hidden border-t border-gray-100 bg-white shadow-lg">
            <nav className="max-w-7xl mx-auto px-4 py-4 flex flex-col gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className={cn(
                    "block px-3 py-3 text-sm font-bold tracking-wide border-b border-gray-50 transition-colors",
                    location === link.href
                      ? "text-primary"
                      : "text-foreground hover:text-primary"
                  )}
                >
                  {lang === "sw" ? link.labelSw : link.labelEn}
                </Link>
              ))}
              <div className="pt-3 flex flex-col gap-2">
                <Link
                  href="/sign-in"
                  onClick={() => setMenuOpen(false)}
                  className="block text-center bg-black text-white py-3 font-bold text-sm tracking-wider"
                >
                  {t("Sign In", "Ingia")}
                </Link>
                <Link
                  href="/volunteer-register"
                  onClick={() => setMenuOpen(false)}
                  className="block text-center bg-primary text-white py-3 font-bold text-sm tracking-wider"
                >
                  {t("Volunteer", "Jitolee")}
                </Link>
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* Page content */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="bg-black text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 mb-10">
            {/* Logo + tagline */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-col leading-none">
                <div className="bg-primary text-white font-black text-sm px-2 py-0.5 tracking-wider inline-block">
                  LINDA
                </div>
                <div className="text-white font-black text-[10px] tracking-[0.2em] mt-0.5">
                  MWANANCHI
                </div>
              </div>
              <p className="text-gray-400 text-xs font-medium tracking-wider uppercase">
                IT'S TIME. BE PART OF THE CHANGE.
              </p>
            </div>

            {/* Nav links */}
            <div>
              <p className="text-xs font-black tracking-widest uppercase text-gray-400 mb-4">
                {t("Pages", "Kurasa")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {footerLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="text-sm text-gray-300 hover:text-primary transition-colors font-medium flex items-center gap-1"
                  >
                    <ChevronRight className="h-3 w-3" />
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>

            {/* M-Pesa */}
            <div>
              <p className="text-xs font-black tracking-widest uppercase text-gray-400 mb-4">
                {t("Donate via M-Pesa", "Changia kupitia M-Pesa")}
              </p>
              <div className="bg-white/5 border border-white/10 p-4">
                <div className="text-xs text-gray-400 uppercase tracking-widest mb-1">
                  {t("Paybill Number", "Nambari ya Paybill")}
                </div>
                <div className="text-3xl font-black text-primary tracking-widest">3033049</div>
                <div className="text-xs text-gray-400 mt-2">
                  {t("Account:", "Akaunti:")} <span className="text-white font-bold">CAMPAIGN</span>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-1">
                <a href="mailto:info@lindamwananchi.ke" className="text-sm text-gray-300 hover:text-primary transition-colors">
                  info@lindamwananchi.ke
                </a>
                <a href="https://wa.me/254700000000" className="text-sm text-gray-300 hover:text-primary transition-colors">
                  WhatsApp: +254 700 000 000
                </a>
              </div>
            </div>
          </div>

          <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-gray-500 text-xs">
              © 2027 Linda Mwananchi. All rights reserved.
            </p>
            <div className="flex items-center gap-4">
              <Link href="/data-request" className="text-xs text-gray-500 hover:text-white transition-colors">
                {t("Data Subject Request", "Ombi la Data")}
              </Link>
              <Link href="/contact" className="text-xs text-gray-500 hover:text-white transition-colors">
                {t("Contact", "Wasiliana")}
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
