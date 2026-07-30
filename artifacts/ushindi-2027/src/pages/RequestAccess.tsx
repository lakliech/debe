/**
 * RequestAccess — Debe platform enquiry form.
 * Shown when a visitor clicks "Request Access" or "Get Your Campaign on Debe"
 * from the DebeHome landing page.
 */
import { useState, FormEvent } from "react";
import { Link } from "wouter";
import { ChevronRight, ArrowLeft, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

const ELECTION_LEVELS = [
  "Presidential",
  "Gubernatorial",
  "Senatorial",
  "Women Rep",
  "MP",
  "MCA",
  "Not sure yet",
];

type Status = "idle" | "submitting" | "success" | "error";

export default function RequestAccess() {
  const [status, setStatus]     = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const [form, setForm] = useState({
    fullName:      "",
    email:         "",
    organisation:  "",
    electionLevel: "",
    message:       "",
  });

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg("");

    try {
      const res = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `Server error ${res.status}`);
      }
      setStatus("success");
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-white selection:bg-primary selection:text-white">

      {/* Minimal header */}
      <header className="px-6 h-16 flex items-center justify-between border-b border-gray-100 bg-white z-20">
        <Link href="/" className="flex items-center gap-2 leading-none">
          <div className="bg-primary text-white font-black text-lg px-2.5 py-0.5 tracking-[0.15em]">
            DEBE
          </div>
          <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-gray-400 hidden sm:block">
            Digital Ballot Box
          </span>
        </Link>
        <Link
          href="/"
          className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-500 hover:text-black transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </Link>
      </header>

      <main className="flex-1 flex flex-col">

        {/* Hero band */}
        <section className="bg-slate-950 text-white py-14 px-6">
          <div className="max-w-2xl mx-auto text-center flex flex-col items-center gap-4">
            <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 px-4 py-2 text-xs font-bold tracking-[0.2em] uppercase text-primary">
              Get Started
            </div>
            <h1 className="text-4xl sm:text-5xl font-black tracking-tighter uppercase leading-[1.0]">
              Request Access to Debe
            </h1>
            <p className="text-slate-300 text-lg max-w-lg leading-relaxed">
              Tell us about your campaign and we'll provision your branded portal, usually
              within one business day.
            </p>
          </div>
        </section>

        {/* Form / success */}
        <section className="bg-slate-50 flex-1 py-16 px-6">
          <div className="max-w-xl mx-auto">

            {status === "success" ? (
              /* ── Success state ───────────────────────────────────────── */
              <div className="bg-white border border-gray-200 p-10 flex flex-col items-center text-center gap-6">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="w-9 h-9 text-primary" />
                </div>
                <div>
                  <h2 className="text-2xl font-black uppercase tracking-tight text-slate-900 mb-2">
                    Enquiry received
                  </h2>
                  <p className="text-slate-500 leading-relaxed">
                    Thanks for reaching out. A member of the Debe team will contact you at{" "}
                    <strong className="text-slate-800">{form.email}</strong> shortly to discuss
                    your campaign's needs.
                  </p>
                </div>
                <Link
                  href="/"
                  className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary hover:underline"
                >
                  <ArrowLeft className="w-4 h-4" /> Back to Debe
                </Link>
              </div>
            ) : (
              /* ── Form ───────────────────────────────────────────────── */
              <form
                onSubmit={handleSubmit}
                className="bg-white border border-gray-200 p-8 sm:p-10 flex flex-col gap-6"
              >
                {/* Error banner */}
                {status === "error" && (
                  <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {/* Full name */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-700">
                    Full Name <span className="text-primary">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={form.fullName}
                    onChange={set("fullName")}
                    placeholder="e.g. Jane Wanjiku"
                    className="border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:border-primary transition-colors"
                  />
                </div>

                {/* Email */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-700">
                    Email Address <span className="text-primary">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={set("email")}
                    placeholder="jane@campaignhq.ke"
                    className="border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:border-primary transition-colors"
                  />
                </div>

                {/* Organisation */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-700">
                    Campaign / Organisation <span className="text-primary">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={form.organisation}
                    onChange={set("organisation")}
                    placeholder="e.g. Wanjiku 2027 Campaign"
                    className="border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:border-primary transition-colors"
                  />
                </div>

                {/* Election level */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-700">
                    Election Level <span className="text-primary">*</span>
                  </label>
                  <select
                    required
                    value={form.electionLevel}
                    onChange={set("electionLevel")}
                    className="border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:border-primary transition-colors bg-white appearance-none"
                  >
                    <option value="" disabled>Select your election level…</option>
                    {ELECTION_LEVELS.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>

                {/* Message */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-700">
                    Message{" "}
                    <span className="text-gray-400 font-normal normal-case tracking-normal">
                      (optional)
                    </span>
                  </label>
                  <textarea
                    rows={4}
                    value={form.message}
                    onChange={set("message")}
                    placeholder="Tell us anything useful: timeline, constituency, team size…"
                    className="border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:border-primary transition-colors resize-none"
                  />
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={status === "submitting"}
                  className="bg-primary text-white hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed px-8 py-4 font-black text-sm tracking-widest uppercase transition-colors flex items-center justify-center gap-2 group"
                >
                  {status === "submitting" ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      Request Access
                      <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>

                <p className="text-xs text-gray-400 text-center">
                  We'll respond within one business day. No spam, ever.
                </p>
              </form>
            )}
          </div>
        </section>

        {/* Footer */}
        <footer className="bg-slate-950 text-white py-8 px-6">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary text-white font-black text-sm px-2.5 py-0.5 tracking-[0.15em]">
                DEBE
              </div>
              <span className="text-slate-500 text-xs tracking-wider uppercase">
                Digital Ballot Box
              </span>
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
