import { useQuery } from "@tanstack/react-query";
import { Shield, AlertTriangle, CheckCircle, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function PrivilegedAccessPage() {
  const { data, isLoading, error } = useQuery<{
    users: any[]; violations: any[]; privilegeGroups: any[]; checkedAt: string;
  }>({
    queryKey: ["privileged-access-review"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/privileged-access/review`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" />
          Privileged Access Review
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Verifies the four-eyes principle: no single user may simultaneously hold tally-alteration, payment-approval, and audit-management privileges.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-4">
            <p className="text-sm text-red-700 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {(error as Error).message} — you may not have access to this page.
            </p>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Total Users</p>
                    <p className="text-2xl font-bold">{data.users.length}</p>
                  </div>
                  <Users className="h-5 w-5 text-blue-500" />
                </div>
              </CardContent>
            </Card>
            <Card className={data.violations.length > 0 ? "border-red-300" : ""}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Violations</p>
                    <p className={`text-2xl font-bold ${data.violations.length > 0 ? "text-red-600" : "text-green-600"}`}>
                      {data.violations.length}
                    </p>
                  </div>
                  {data.violations.length > 0 ? (
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                  ) : (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Last Checked</p>
                <p className="text-sm font-medium mt-1">
                  {data.checkedAt ? new Date(data.checkedAt).toLocaleString() : "—"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Violations */}
          {data.violations.length > 0 ? (
            <Card className="border-red-300">
              <CardHeader>
                <CardTitle className="text-base text-red-700 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> Privilege Conflicts Detected
                </CardTitle>
                <CardDescription>
                  These users hold conflicting privileges that violate the four-eyes principle. Remove one of the conflicting role groups immediately.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.violations.map((v, i) => (
                    <div key={i} className="border border-red-200 rounded-md px-4 py-3 bg-red-50">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-medium text-sm">{v.fullName || v.email}</p>
                          <p className="text-xs text-muted-foreground">{v.email}</p>
                          <p className="text-xs text-red-700 mt-1 font-medium">{v.conflictRule}</p>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {v.heldRoles.map((r: string) => (
                              <Badge key={r} variant="outline" className="text-xs border-red-300 text-red-700">{r}</Badge>
                            ))}
                          </div>
                        </div>
                        <Badge variant="destructive" className="shrink-0">Conflict</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-green-200 bg-green-50">
              <CardContent className="pt-4">
                <p className="text-sm text-green-700 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  No privilege conflicts detected. The four-eyes principle is satisfied.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Privilege Groups */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conflict Rules</CardTitle>
              <CardDescription>No single user may hold roles from 2 or more of the following groups simultaneously.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.privilegeGroups.map((rule: any) => (
                <div key={rule.name} className="mb-4 last:mb-0">
                  <p className="text-sm font-semibold mb-2">{rule.name}</p>
                  <p className="text-xs text-muted-foreground mb-2">{rule.description}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {rule.groups.map((g: any) => (
                      <div key={g.label} className="border rounded-md p-2">
                        <p className="text-xs font-medium mb-1">{g.label}</p>
                        <div className="flex flex-wrap gap-1">
                          {g.roles.map((r: string) => (
                            <Badge key={r} variant="secondary" className="text-xs">{r}</Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
