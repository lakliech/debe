import { useState } from "react";
import { Link } from "wouter";
import { useListUsers, useSuspendUser } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Filter, MoreVertical, ShieldAlert, CheckCircle2, UserX } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format } from "date-fns";

export default function Users() {
  const [search, setSearch] = useState("");
  const { data: users, isLoading } = useListUsers();
  const suspendUser = useSuspendUser();

  const handleSuspend = (id: string) => {
    if (confirm("Are you sure you want to suspend this user? They will lose all system access.")) {
      suspendUser.mutate({ id, data: { reason: "Manual suspension from dashboard" } });
    }
  };

  const filteredUsers = users?.filter(u => 
    u.fullName.toLowerCase().includes(search.toLowerCase()) || 
    u.email.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">User Management</h1>
          <p className="text-muted-foreground mt-1">Manage personnel, roles, and access status.</p>
        </div>
        <Button className="bg-primary hover:bg-primary/90">
          Provision User
        </Button>
      </div>

      <div className="bg-card border border-border rounded-md shadow-sm">
        <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-4 justify-between items-center bg-muted/30">
          <div className="relative w-full sm:w-96">
            <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
            <Input 
              placeholder="Search by name or email..." 
              className="pl-9 bg-background"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" className="w-full sm:w-auto flex items-center gap-2">
            <Filter className="w-4 h-4" /> Filters
          </Button>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="font-semibold text-foreground">Personnel</TableHead>
                <TableHead className="font-semibold text-foreground">Primary Role</TableHead>
                <TableHead className="font-semibold text-foreground">Location</TableHead>
                <TableHead className="font-semibold text-foreground">Status</TableHead>
                <TableHead className="font-semibold text-foreground">Last Active</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><div className="h-10 bg-muted rounded animate-pulse" /></TableCell>
                    <TableCell><div className="h-6 w-24 bg-muted rounded animate-pulse" /></TableCell>
                    <TableCell><div className="h-6 w-32 bg-muted rounded animate-pulse" /></TableCell>
                    <TableCell><div className="h-6 w-16 bg-muted rounded animate-pulse" /></TableCell>
                    <TableCell><div className="h-6 w-20 bg-muted rounded animate-pulse" /></TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                ))
              ) : filteredUsers.length > 0 ? (
                filteredUsers.map((user) => (
                  <TableRow key={user.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-sm bg-primary/10 text-primary flex items-center justify-center font-bold text-xs uppercase border border-primary/20">
                          {user.fullName.substring(0, 2)}
                        </div>
                        <div>
                          <p className="font-bold text-sm text-foreground">{user.fullName}</p>
                          <p className="text-xs text-muted-foreground font-mono">{user.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.roles && user.roles.length > 0 ? (
                        <Badge variant="outline" className="bg-background">
                          {user.roles[0].roleName}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium">
                        {user.countyId ? `County #${user.countyId}` : "National"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {user.status === 'active' ? (
                        <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 flex w-fit items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Active
                        </Badge>
                      ) : user.status === 'suspended' ? (
                        <Badge variant="destructive" className="flex w-fit items-center gap-1">
                          <UserX className="w-3 h-3" /> Suspended
                        </Badge>
                      ) : (
                        <Badge variant="secondary">{user.status}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground font-mono">
                      {user.lastLoginAt ? format(new Date(user.lastLoginAt), "dd MMM, HH:mm") : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">Open menu</span>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <Link href={`/users/${user.id}`}>
                            <DropdownMenuItem className="cursor-pointer">View Profile</DropdownMenuItem>
                          </Link>
                          <DropdownMenuItem className="cursor-pointer">Edit Roles</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {user.status === 'active' && (
                            <DropdownMenuItem 
                              className="text-destructive focus:text-destructive cursor-pointer flex items-center gap-2"
                              onClick={() => handleSuspend(user.id)}
                            >
                              <ShieldAlert className="w-4 h-4" /> Suspend Access
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    No personnel records found matching your criteria.
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
