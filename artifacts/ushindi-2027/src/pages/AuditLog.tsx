import { useListAuditLogs } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Download, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

export default function AuditLog() {
  const { data: logs, isLoading } = useListAuditLogs({ limit: 50 });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-3">
            System Audit Log <ShieldCheck className="w-6 h-6 text-primary" />
          </h1>
          <p className="text-muted-foreground mt-1">Immutable record of all critical system actions.</p>
        </div>
        <Button variant="outline" className="flex items-center gap-2">
          <Download className="w-4 h-4" /> Export CSV
        </Button>
      </div>

      <div className="bg-card border border-border rounded-md shadow-sm">
        <div className="p-4 border-b border-border bg-muted/30">
          <div className="relative w-full sm:w-96">
            <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
            <Input 
              placeholder="Search event, user or resource..." 
              className="pl-9 bg-background"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="font-semibold text-foreground w-[180px]">Timestamp</TableHead>
                <TableHead className="font-semibold text-foreground">Actor</TableHead>
                <TableHead className="font-semibold text-foreground">Action</TableHead>
                <TableHead className="font-semibold text-foreground">Resource</TableHead>
                <TableHead className="font-semibold text-foreground text-right">IP Address</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">Loading secure records...</TableCell>
                </TableRow>
              ) : logs && logs.length > 0 ? (
                logs.map(log => (
                  <TableRow key={log.id} className="font-mono text-sm hover:bg-muted/30">
                    <TableCell className="text-muted-foreground">
                      {format(new Date(log.createdAt), "yyyy-MM-dd HH:mm:ss")}
                    </TableCell>
                    <TableCell>
                      <span className="font-bold text-foreground font-sans">{log.userFullName || log.userEmail}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-background font-mono font-normal">
                        {log.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {log.resource} <span className="opacity-50">[{log.resourceId?.substring(0,8)}]</span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {log.ipAddress || "127.0.0.1"}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                    No audit records found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
