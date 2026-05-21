import { useState } from "react";
import { useListLeads, useCreateLead, useDeleteLead, getListLeadsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, Trash2, Search, Users } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const schema = z.object({
  email: z.string().email("Valid email required"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

const STATUS_COLORS: Record<string, string> = {
  active: "default",
  unsubscribed: "secondary",
  bounced: "destructive",
  replied: "outline",
};

export default function Leads() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: leads, isLoading } = useListLeads();

  const create = useCreateLead({
    mutation: {
      onSuccess: () => {
        toast({ title: "Lead added" });
        queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
        setOpen(false);
        form.reset();
      },
      onError: () => toast({ title: "Failed to add lead", variant: "destructive" }),
    },
  });

  const remove = useDeleteLead({
    mutation: {
      onSuccess: () => {
        toast({ title: "Lead removed" });
        queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
      },
      onError: () => toast({ title: "Failed to remove lead", variant: "destructive" }),
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", firstName: "", lastName: "", company: "", title: "" },
  });

  function onSubmit(values: FormValues) {
    create.mutate({ data: values });
  }

  const filtered = leads?.filter(l =>
    l.email.toLowerCase().includes(search.toLowerCase()) ||
    l.firstName?.toLowerCase().includes(search.toLowerCase()) ||
    l.lastName?.toLowerCase().includes(search.toLowerCase()) ||
    l.company?.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground mt-1">{leads?.length ?? 0} total leads</p>
        </div>
        <Button onClick={() => setOpen(true)} data-testid="button-add-lead">
          <Plus className="mr-2 h-4 w-4" /> Add Lead
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search leads..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
          data-testid="input-search-leads"
        />
      </div>

      <div className="rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading leads...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-16">
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <Users className="h-8 w-8 opacity-40" />
                    <span className="text-sm">{search ? "No leads match your search" : "No leads yet. Add your first lead to get started."}</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : filtered.map(lead => (
              <TableRow key={lead.id} data-testid={`row-lead-${lead.id ?? 0}`}>
                <TableCell className="font-medium">{lead.email}</TableCell>
                <TableCell>{[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "—"}</TableCell>
                <TableCell>{lead.company || "—"}</TableCell>
                <TableCell>{lead.title || "—"}</TableCell>
                <TableCell>
                  <Badge variant={(STATUS_COLORS[lead.status ?? "active"] ?? "secondary") as any}>{lead.status}</Badge>
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" data-testid={`button-lead-menu-${lead.id}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => remove.mutate({ id: lead.id })}
                        data-testid={`button-delete-lead-${lead.id}`}
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Lead</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email <span className="text-destructive">*</span></FormLabel>
                  <FormControl><Input placeholder="lead@company.com" data-testid="input-lead-email" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="firstName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name</FormLabel>
                    <FormControl><Input placeholder="Jane" data-testid="input-lead-firstname" {...field} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="lastName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last Name</FormLabel>
                    <FormControl><Input placeholder="Smith" data-testid="input-lead-lastname" {...field} /></FormControl>
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="company" render={({ field }) => (
                <FormItem>
                  <FormLabel>Company</FormLabel>
                  <FormControl><Input placeholder="Acme Corp" data-testid="input-lead-company" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Job Title</FormLabel>
                  <FormControl><Input placeholder="Head of Growth" data-testid="input-lead-title" {...field} /></FormControl>
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-lead">Cancel</Button>
                <Button type="submit" disabled={create.isPending} data-testid="button-submit-lead">
                  {create.isPending ? "Adding..." : "Add Lead"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
