/**
 * PVTQuickReportForm — mobile-optimized quick count form for agents at
 * PVT-sampled stations. Separate from the full result form: simplified counts
 * first for live projection, full form through the normal submission flow.
 */
import { useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, CheckCircle2, ClipboardList } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const PALETTE = ["#1D9BF0", "#F4212E", "#00BA7C", "#FFD400", "#7856FF", "#FF7A00"];

const reportSchema = z.object({
  totalVotesCast: z.coerce.number().int().min(0, "Must be 0 or more"),
  registeredVoters: z.coerce.number().int().min(1),
  rejectedBallots: z.coerce.number().int().min(0),
  candidateVotes: z.array(z.object({
    candidateId: z.string(),
    name: z.string(),
    votes: z.coerce.number().int().min(0),
  })).min(1),
  confirmed: z.literal(true, { errorMap: () => ({ message: "You must confirm accuracy" }) }),
});

type ReportForm = z.infer<typeof reportSchema>;

export default function PVTQuickReportForm() {
  const params = useParams();
  const stationId = params.stationId as string;
  const [, navigate] = useLocation();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const { data: station } = useQuery({
    queryKey: ["pvt-station", stationId],
    queryFn: () => fetch(`${BASE}/api/pvt/stations/${stationId}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!stationId,
  });

  const { data: elections } = useQuery({
    queryKey: ["elections-active-pvt"],
    queryFn: () => fetch(`${BASE}/api/election-admin/elections/active`, { credentials: "include" }).then((r) => r.json()),
  });
  const activeElection = (elections as any[] | undefined)?.find((e: any) => e.isActive) ?? (elections as any[])?.[0];

  const { data: candidates } = useQuery({
    queryKey: ["candidates", activeElection?.id],
    queryFn: () =>
      fetch(`${BASE}/api/election-admin/elections/${activeElection!.id}/candidates`, { credentials: "include" })
        .then((r) => r.json()),
    enabled: !!activeElection?.id,
  });

  const form = useForm<ReportForm>({
    resolver: zodResolver(reportSchema),
    defaultValues: { totalVotesCast: 0, registeredVoters: 1, rejectedBallots: 0, candidateVotes: [], confirmed: undefined as any },
  });
  const { fields, replace } = useFieldArray({ control: form.control, name: "candidateVotes" });

  // Pre-fill candidate rows + registered voters once data arrives
  useMemo(() => {
    if (Array.isArray(candidates) && candidates.length && fields.length === 0) {
      replace(candidates
        .slice()
        .sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
        .map((c: any) => ({ candidateId: c.id, name: c.fullName, votes: 0 })));
    }
    if (station?.registeredVoters) {
      form.setValue("registeredVoters", station.registeredVoters);
    }
  }, [candidates, station]);

  const watchCast = form.watch("totalVotesCast");
  const watchRejected = form.watch("rejectedBallots");
  const watchVotes = form.watch("candidateVotes");

  const candidateTotal = (watchVotes ?? []).reduce((a, c) => a + (Number(c.votes) || 0), 0);
  const validBallots = (Number(watchCast) || 0) - (Number(watchRejected) || 0);
  const balance: "exact" | "under" | "over" =
    candidateTotal === validBallots ? "exact" : candidateTotal < validBallots ? "under" : "over";

  async function onSubmit(values: ReportForm) {
    setSubmitError(null);
    const res = await fetch(`${BASE}/api/pvt/quick-reports`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sampledStationId: stationId,
        totalVotesCast: values.totalVotesCast,
        registeredVoters: values.registeredVoters,
        rejectedBallots: values.rejectedBallots,
        candidateVotes: values.candidateVotes.map((c) => ({ candidateId: c.candidateId, votes: Number(c.votes) || 0 })),
        source: "mobile",
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setSubmitError(body.error ?? `Submission failed (${res.status})`);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <Card className="max-w-lg mx-auto mt-8">
        <CardContent className="p-8 text-center space-y-3">
          <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
          <h2 className="text-xl font-black">Quick report received</h2>
          <p className="text-sm text-muted-foreground">
            The projection has been updated. Remember to also submit the full result form through the normal flow.
          </p>
          <Button variant="outline" onClick={() => navigate("/")}>Done</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-4 pb-8">
      {/* Header */}
      <Card>
        <CardContent className="p-4 space-y-1">
          <Badge className="bg-[#1D9BF0]">PVT SAMPLED STATION</Badge>
          <h1 className="text-xl font-black flex items-center gap-2 mt-1">
            <ClipboardList className="h-5 w-5" /> Quick Count Report
          </h1>
          {station && (
            <p className="text-sm text-muted-foreground">
              {station.stratumName} · {station.registeredVoters?.toLocaleString()} registered voters
            </p>
          )}
        </CardContent>
      </Card>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider">Total Votes Cast</label>
                <Input type="number" min={0} inputMode="numeric" {...form.register("totalVotesCast")} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider">Registered Voters</label>
                <Input type="number" min={1} inputMode="numeric" {...form.register("registeredVoters")} />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider">Rejected Ballots</label>
              <Input type="number" min={0} inputMode="numeric" {...form.register("rejectedBallots")} />
            </div>
          </CardContent>
        </Card>

        {/* Candidate rows */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider">Votes per candidate</p>
            {fields.map((f, i) => (
              <div key={f.id} className="flex items-center gap-3">
                <span className="w-2 h-8 rounded shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="flex-1 text-sm font-medium truncate">{f.name}</span>
                <Input type="number" min={0} inputMode="numeric" className="w-24"
                  {...form.register(`candidateVotes.${i}.votes` as const)} />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Live balance check */}
        <Card className={
          balance === "exact" ? "border-green-500" : balance === "over" ? "border-red-500" : "border-amber-500"
        }>
          <CardContent className="p-4 text-sm">
            <p className="font-bold">
              Candidate total: {candidateTotal.toLocaleString()} · Valid ballots: {validBallots.toLocaleString()}
            </p>
            <p className={
              balance === "exact" ? "text-green-700" : balance === "over" ? "text-red-700" : "text-amber-700"
            }>
              {balance === "exact"
                ? "Balanced — candidate votes equal valid ballots."
                : balance === "over"
                  ? `Over by ${(candidateTotal - validBallots).toLocaleString()} — cannot submit.`
                  : `Under by ${(validBallots - candidateTotal).toLocaleString()} — check for missing votes before submitting.`}
            </p>
          </CardContent>
        </Card>

        {/* Legal confirmation */}
        <Card>
          <CardContent className="p-4 flex items-start gap-3">
            <Checkbox
              checked={!!form.watch("confirmed")}
              onCheckedChange={(v) => form.setValue("confirmed", v === true ? true : (undefined as any), { shouldValidate: true })}
            />
            <p className="text-xs text-muted-foreground">
              I confirm these figures accurately reflect the results announced at this polling station.
              Submitting false election results is an offence under Kenyan electoral law.
            </p>
          </CardContent>
        </Card>

        {submitError && (
          <p className="text-sm text-red-700 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" /> {submitError}
          </p>
        )}

        <Button
          type="submit"
          className="w-full bg-[#1D9BF0] hover:bg-[#1a8fd1]"
          disabled={balance === "over" || form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? "Submitting…" : "Submit Quick Report"}
        </Button>
      </form>
    </div>
  );
}
