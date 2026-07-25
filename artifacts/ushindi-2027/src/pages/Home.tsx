import { Link } from "wouter";
import { ChevronRight, MapPin, Activity, Shield, Users } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-white selection:bg-primary selection:text-white">
      {/* Top announcement bar */}
      <div className="bg-black text-white text-xs sm:text-sm text-center py-2.5 px-4 font-medium tracking-wide">
        Uko Kadi?{" "}
        <span className="underline underline-offset-2 cursor-pointer hover:text-primary transition-colors">
          Verify if you are a registered voter
        </span>
      </div>

      {/* Header */}
      <header className="px-6 h-16 flex items-center justify-between border-b border-gray-100 bg-white z-10 relative">
        <div className="flex items-center gap-3">
          {/* Linda Mwananchi logo mark */}
          <div className="flex flex-col leading-none">
            <div className="bg-primary text-white font-black text-sm px-2 py-0.5 tracking-wider">
              LINDA
            </div>
            <div className="text-black font-black text-[10px] tracking-[0.2em] mt-0.5">
              MWANANCHI
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/sign-in"
            className="text-sm font-bold text-foreground hover:text-primary transition-colors hidden sm:block tracking-wide"
          >
            SIGN IN
          </Link>
          <Link
            href="/sign-up"
            className="bg-primary text-white hover:bg-primary/90 px-5 py-2 font-bold text-sm transition-all tracking-wide"
          >
            SUPPORT
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col">
        <div className="flex-1 flex flex-col lg:flex-row items-center max-w-7xl mx-auto w-full px-6 py-16 lg:py-24 gap-12 lg:gap-20">
          {/* Left: Headline */}
          <div className="flex-1 flex flex-col gap-6">
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tighter text-black leading-[1.0] uppercase">
              IT'S TIME.{" "}
              <span className="text-primary">BE PART</span>
              <br />
              OF THE CHANGE.
            </h1>
            <p className="text-lg text-gray-600 max-w-xl leading-relaxed">
              Sign up to join the move to make Kenya better.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mt-4">
              <Link
                href="/sign-up"
                className="bg-primary text-white hover:bg-primary/90 px-8 py-4 font-black text-base tracking-widest uppercase transition-all flex items-center justify-center gap-2 group"
              >
                Count Me In
                <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                href="/sign-in"
                className="bg-black text-white hover:bg-black/80 px-8 py-4 font-black text-base tracking-widest uppercase transition-all flex items-center justify-center"
              >
                Agent Login
              </Link>
            </div>
          </div>

          {/* Right: Counter card */}
          <div className="w-full max-w-sm lg:max-w-xs">
            <div className="border-4 border-black p-8 bg-white relative">
              {/* Corner accent */}
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
                href="/sign-up"
                className="block w-full bg-primary text-white text-center py-3.5 font-black tracking-widest uppercase text-sm hover:bg-primary/90 transition-colors"
              >
                COUNT ME IN
              </Link>
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
            href="/sign-up"
            className="bg-primary text-white hover:bg-primary/90 px-6 py-3 font-bold text-sm tracking-wider uppercase transition-colors whitespace-nowrap flex items-center gap-2"
          >
            Contribute Securely <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Feature grid */}
        <div className="bg-white border-t border-gray-100 py-16 px-6">
          <div className="max-w-7xl mx-auto">
            <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-3">
              Campaign Operations
            </p>
            <h2 className="text-3xl font-black text-black uppercase tracking-tight mb-12">
              The Command Centre
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              {[
                {
                  icon: MapPin,
                  title: "National Coverage",
                  desc: "Real-time visibility from national HQ down to individual polling stations across all 47 counties.",
                },
                {
                  icon: Users,
                  title: "Volunteer Network",
                  desc: "Coordinate thousands of volunteers and polling agents with precision role assignment.",
                },
                {
                  icon: Activity,
                  title: "Live Operations",
                  desc: "Instant incident reporting, tally tracking, and coordination during critical election days.",
                },
                {
                  icon: Shield,
                  title: "Secure Access",
                  desc: "24 distinct permission levels with immutable audit logging and data protection compliance.",
                },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex flex-col gap-4">
                  <div className="w-12 h-12 bg-primary flex items-center justify-center">
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-base font-black uppercase tracking-wide text-black">{title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="bg-black text-white py-8 px-6">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex flex-col leading-none">
              <div className="bg-primary text-white font-black text-xs px-1.5 py-0.5 tracking-wider inline-block">
                LINDA
              </div>
              <div className="text-white font-black text-[9px] tracking-[0.2em] mt-0.5">
                MWANANCHI
              </div>
            </div>
            <p className="text-gray-400 text-xs text-center">
              Linda Mwananchi 2027 Campaign. Secure Operations Platform.
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}
