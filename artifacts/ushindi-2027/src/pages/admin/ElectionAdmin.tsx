import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings2, Plus, Edit, Trash2, Star, CheckCircle2, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ElectionForm {
  electionType: string;
  year: string;
  name: string;
  electionDate: string;
  description: string;
}

const defaultElectionForm: ElectionForm = {
  electionType: "presidential",
  year: new Date().getFullYear().toString(),
  name: "",
  electionDate: "",
  description: "",
};

interface CandidateForm {
  fullName: string;
  partyName: string;
  partyAbbreviation: string;
  isOurCandidate: boolean;
  displayOrder: string;
  photoUrl: string;
}

const defaultCandidateForm: CandidateForm = {
  fullName: "",
  partyName: "",
  partyAbbreviation: "",
  isOurCandidate: false,
  displayOrder: "1",
  photoUrl: "",
};

export default function ElectionAdmin() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [electionSheet, setElectionSheet] = useState(false);
  const [editingElection, setEditingElection] = useState<any | null>(null);
  const [electionForm, setElectionForm] = useState<ElectionForm>(defaultElectionForm);

  const [selectedElectionId, setSelectedElectionId] = useState<string | null>(null);
  const [candidateSheet, setCandidateSheet] = useState(false);
  const [editingCandidate, setEditingCandidate] = useState<any | null>(null);
  const [candidateForm, setCandidateForm] = useState<CandidateForm>(defaultCandidateForm);

  // Fetch elections
  const { data: elections, isLoading: electionsLoading } = useQuery({
    queryKey: ["elections"],
    queryFn: () =>
      fetch(`${BASE}/api/election-admin/elections`, { credentials: "include" }).then((r) => r.json()),
  });

  // Fetch candidates for selected election
  const { data: candidates, isLoading: candidatesLoading } = useQuery({
    queryKey: ["election-candidates", selectedElectionId],
    queryFn: () =>
      fetch(`${BASE}/api/election-admin/elections/${selectedElectionId}/candidates`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!selectedElectionId,
  });

  // Create / Update election
  const electionMutation = useMutation({
    mutationFn: (body: ElectionForm & { id?: string }) => {
      const { id, ...rest } = body;
      const method = id ? "PATCH" : "POST";
      const url = id ? `${BASE}/api/election-admin/elections/${id}` : `${BASE}/api/election-admin/elections`;
      return fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rest, year: Number(rest.year) }),
      }).then((r) => r.json());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["elections"] });
      setElectionSheet(false);
      setEditingElection(null);
      setElectionForm(defaultElectionForm);
      toast({ title: editingElection ? "Election updated" : "Election created" });
    },
    onError: () => toast({ title: "Failed to save election", variant: "destructive" }),
  });

  // Set active election (uses PATCH with {isActive: true})
  const setActiveMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`${BASE}/api/election-admin/elections/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["elections"] });
      toast({ title: "Active election updated" });
    },
    onError: () => toast({ title: "Failed to set active", variant: "destructive" }),
  });

  // Create / Update candidate
  const candidateMutation = useMutation({
    mutationFn: (body: CandidateForm & { id?: string }) => {
      const { id, ...rest } = body;
      const method = id ? "PATCH" : "POST";
      const url = id
        ? `${BASE}/api/election-admin/elections/${selectedElectionId}/candidates/${id}`
        : `${BASE}/api/election-admin/elections/${selectedElectionId}/candidates`;
      return fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rest, displayOrder: Number(rest.displayOrder) }),
      }).then((r) => r.json());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["election-candidates", selectedElectionId] });
      setCandidateSheet(false);
      setEditingCandidate(null);
      setCandidateForm(defaultCandidateForm);
      toast({ title: editingCandidate ? "Candidate updated" : "Candidate added" });
    },
    onError: () => toast({ title: "Failed to save candidate", variant: "destructive" }),
  });

  // Delete candidate
  const deleteCandidateMutation = useMutation({
    mutationFn: (candidateId: string) =>
      fetch(`${BASE}/api/election-admin/elections/${selectedElectionId}/candidates/${candidateId}`, {
        method: "DELETE",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["election-candidates", selectedElectionId] });
      toast({ title: "Candidate removed" });
    },
    onError: () => toast({ title: "Failed to delete candidate", variant: "destructive" }),
  });

  const openEditElection = (election: any) => {
    setEditingElection(election);
    setElectionForm({
      electionType: election.electionType ?? "presidential",
      year: String(election.year ?? new Date().getFullYear()),
      name: election.name ?? "",
      electionDate: election.electionDate ?? "",
      description: election.description ?? "",
    });
    setElectionSheet(true);
  };

  const openAddCandidate = () => {
    setEditingCandidate(null);
    setCandidateForm(defaultCandidateForm);
    setCandidateSheet(true);
  };

  const openEditCandidate = (candidate: any) => {
    setEditingCandidate(candidate);
    setCandidateForm({
      fullName: candidate.fullName ?? "",
      partyName: candidate.partyName ?? "",
      partyAbbreviation: candidate.partyAbbreviation ?? "",
      isOurCandidate: candidate.isOurCandidate ?? false,
      displayOrder: String(candidate.displayOrder ?? 1),
      photoUrl: candidate.photoUrl ?? "",
    });
    setCandidateSheet(true);
  };

  const setElField = <K extends keyof ElectionForm>(key: K, value: ElectionForm[K]) =>
    setElectionForm((f) => ({ ...f, [key]: value }));

  const setCaField = <K extends keyof CandidateForm>(key: K, value: CandidateForm[K]) =>
    setCandidateForm((f) => ({ ...f, [key]: value }));

  const electionList: any[] = Array.isArray(elections) ? elections : [];
  const candidateList: any[] = Array.isArray(candidates) ? candidates : [];
  const selectedElection = electionList.find((e) => e.id === selectedElectionId);

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight uppercase flex items-center gap-2">
            <Settings2 className="h-6 w-6 text-[#1D9BF0]" /> ELECTION ADMINISTRATION
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Configure elections and manage candidates.</p>
        </div>
        <Button
          className="bg-[#1D9BF0] hover:bg-[#1a8fd1]"
          onClick={() => { setEditingElection(null); setElectionForm(defaultElectionForm); setElectionSheet(true); }}
        >
          <Plus className="h-4 w-4 mr-2" /> Create Election
        </Button>
      </div>

      {/* Elections List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider">Elections</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {electionsLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : electionList.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Settings2 className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p>No elections configured.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {electionList.map((el: any) => (
                  <TableRow
                    key={el.id}
                    className={`cursor-pointer hover:bg-muted/50 ${selectedElectionId === el.id ? "bg-blue-50" : ""}`}
                    onClick={() => setSelectedElectionId(el.id === selectedElectionId ? null : el.id)}
                  >
                    <TableCell className="font-bold">{el.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{el.electionType?.replace(/_/g, " ")}</Badge>
                    </TableCell>
                    <TableCell className="font-mono">{el.year}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {el.electionDate ? new Date(el.electionDate).toLocaleDateString("en-KE") : "—"}
                    </TableCell>
                    <TableCell>
                      {el.isActive ? (
                        <Badge className="bg-green-100 text-green-800 text-xs">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> ACTIVE
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="outline" className="text-xs" onClick={() => openEditElection(el)}>
                          <Edit className="h-3 w-3 mr-1" /> Edit
                        </Button>
                        {!el.isActive && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs border-yellow-400 text-yellow-700 hover:bg-yellow-50"
                            disabled={setActiveMutation.isPending}
                            onClick={() => setActiveMutation.mutate(el.id)}
                          >
                            <Star className="h-3 w-3 mr-1" /> Set Active
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Candidate Management */}
      {selectedElectionId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4 text-[#1D9BF0]" />
                Candidates — {selectedElection?.name ?? "Election"}
              </span>
              <Button size="sm" className="bg-[#1D9BF0] hover:bg-[#1a8fd1]" onClick={openAddCandidate}>
                <Plus className="h-3 w-3 mr-1" /> Add Candidate
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {candidatesLoading ? (
              <div className="space-y-2 p-4">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : candidateList.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-6 w-6 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No candidates yet. Add the first candidate.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Party</TableHead>
                    <TableHead>Abbrev.</TableHead>
                    <TableHead>Our Candidate</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidateList.sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)).map((c: any) => (
                    <TableRow key={c.id} className={c.isOurCandidate ? "bg-blue-50" : ""}>
                      <TableCell className="font-mono text-muted-foreground">{c.displayOrder}</TableCell>
                      <TableCell className="font-bold">
                        {c.fullName}
                        {c.isOurCandidate && (
                          <Badge className="ml-2 bg-[#1D9BF0] text-white text-xs">Ours</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{c.partyName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs font-mono">{c.partyAbbreviation}</Badge>
                      </TableCell>
                      <TableCell>
                        {c.isOurCandidate ? (
                          <CheckCircle2 className="h-4 w-4 text-[#1D9BF0]" />
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="outline" className="text-xs" onClick={() => openEditCandidate(c)}>
                            <Edit className="h-3 w-3 mr-1" /> Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs border-red-300 text-red-700 hover:bg-red-50"
                            disabled={deleteCandidateMutation.isPending}
                            onClick={() => deleteCandidateMutation.mutate(c.id)}
                          >
                            <Trash2 className="h-3 w-3 mr-1" /> Remove
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Election Form Sheet */}
      <Sheet open={electionSheet} onOpenChange={setElectionSheet}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingElection ? "Edit Election" : "Create Election"}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div>
              <Label>Election Name *</Label>
              <Input
                placeholder="e.g. 2027 Presidential Election"
                value={electionForm.name}
                onChange={(e) => setElField("name", e.target.value)}
              />
            </div>
            <div>
              <Label>Election Type *</Label>
              <Select value={electionForm.electionType} onValueChange={(v) => setElField("electionType", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="presidential">Presidential</SelectItem>
                  <SelectItem value="gubernatorial">Gubernatorial</SelectItem>
                  <SelectItem value="senatorial">Senatorial</SelectItem>
                  <SelectItem value="parliamentary">Parliamentary</SelectItem>
                  <SelectItem value="women_rep">Women Representative</SelectItem>
                  <SelectItem value="mca">MCA</SelectItem>
                  <SelectItem value="by_election">By-Election</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Year *</Label>
              <Input
                type="number"
                placeholder="2027"
                value={electionForm.year}
                onChange={(e) => setElField("year", e.target.value)}
              />
            </div>
            <div>
              <Label>Election Date</Label>
              <Input
                type="date"
                value={electionForm.electionDate}
                onChange={(e) => setElField("electionDate", e.target.value)}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Input
                placeholder="Optional description..."
                value={electionForm.description}
                onChange={(e) => setElField("description", e.target.value)}
              />
            </div>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setElectionSheet(false)}>Cancel</Button>
            <Button
              className="bg-[#1D9BF0] hover:bg-[#1a8fd1]"
              disabled={!electionForm.name || electionMutation.isPending}
              onClick={() => electionMutation.mutate(editingElection ? { ...electionForm, id: editingElection.id } : electionForm)}
            >
              {electionMutation.isPending ? "Saving..." : editingElection ? "Update Election" : "Create Election"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Candidate Form Sheet */}
      <Sheet open={candidateSheet} onOpenChange={setCandidateSheet}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingCandidate ? "Edit Candidate" : "Add Candidate"}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div>
              <Label>Full Name *</Label>
              <Input
                placeholder="Candidate full name..."
                value={candidateForm.fullName}
                onChange={(e) => setCaField("fullName", e.target.value)}
              />
            </div>
            <div>
              <Label>Party Name *</Label>
              <Input
                placeholder="Political party name..."
                value={candidateForm.partyName}
                onChange={(e) => setCaField("partyName", e.target.value)}
              />
            </div>
            <div>
              <Label>Party Abbreviation *</Label>
              <Input
                placeholder="e.g. UDA, ODM, KANU"
                value={candidateForm.partyAbbreviation}
                onChange={(e) => setCaField("partyAbbreviation", e.target.value)}
              />
            </div>
            <div>
              <Label>Display Order</Label>
              <Input
                type="number"
                min="1"
                value={candidateForm.displayOrder}
                onChange={(e) => setCaField("displayOrder", e.target.value)}
              />
            </div>
            <div>
              <Label>Photo URL</Label>
              <Input
                placeholder="https://..."
                value={candidateForm.photoUrl}
                onChange={(e) => setCaField("photoUrl", e.target.value)}
              />
            </div>
            <div className="flex items-center gap-3 p-3 border border-border rounded">
              <input
                type="checkbox"
                id="isOurCandidate"
                checked={candidateForm.isOurCandidate}
                onChange={(e) => setCaField("isOurCandidate", e.target.checked)}
                className="w-4 h-4"
              />
              <label htmlFor="isOurCandidate" className="text-sm font-medium cursor-pointer">
                This is our campaign's candidate
              </label>
            </div>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setCandidateSheet(false)}>Cancel</Button>
            <Button
              className="bg-[#1D9BF0] hover:bg-[#1a8fd1]"
              disabled={!candidateForm.fullName || !candidateForm.partyName || !candidateForm.partyAbbreviation || candidateMutation.isPending}
              onClick={() => candidateMutation.mutate(
                editingCandidate ? { ...candidateForm, id: editingCandidate.id } : candidateForm
              )}
            >
              {candidateMutation.isPending ? "Saving..." : editingCandidate ? "Update Candidate" : "Add Candidate"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
