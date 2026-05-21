import { useState, useRef, useMemo } from "react";
import {
  useListLeads, useCreateLead, useDeleteLead, useBulkImportLeads,
  useListLabels, useCreateLabel, useDeleteLabel, useSetLeadLabels,
  getListLeadsQueryKey, getListLabelsQueryKey,
  type Lead,
} from "@workspace/api-client-react";
import { LeadDetailSheet } from "@/components/leads/lead-detail-sheet";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, MoreHorizontal, Trash2, Search, Users, Upload, FileText, CheckCircle2, Tag, X, Filter, Settings2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

const schema = z.object({
  email: z.string().email("Valid email required"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

type LabelLite = { id: number; name: string; color?: string | null };

const STATUS_COLORS: Record<string, string> = {
  active: "default",
  unsubscribed: "secondary",
  bounced: "destructive",
  replied: "outline",
};

const LABEL_COLORS = ["#06b6d4", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#ec4899", "#3b82f6", "#10b981"];

function LabelChip({ label, onRemove }: { label: LabelLite; onRemove?: () => void }) {
  const color = label.color || "#06b6d4";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border"
      style={{ backgroundColor: `${color}22`, borderColor: `${color}55`, color }}
      data-testid={`chip-label-${label.id}`}
    >
      <Tag className="h-2.5 w-2.5" />
      {label.name}
      {onRemove && (
        <button type="button" onClick={onRemove} className="hover:opacity-70" aria-label={`Remove ${label.name}`}>
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

export default function Leads() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; total: number } | null>(null);
  const [selectedFilterLabels, setSelectedFilterLabels] = useState<number[]>([]);
  const [newLeadLabels, setNewLeadLabels] = useState<number[]>([]);
  const [importLabels, setImportLabels] = useState<number[]>([]);
  const [manageLabelsOpen, setManageLabelsOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState(LABEL_COLORS[0]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: leads, isLoading } = useListLeads();
  const { data: labels } = useListLabels({ query: { queryKey: getListLabelsQueryKey() } });

  const invalidateLeads = () => queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
  const invalidateLabels = () => queryClient.invalidateQueries({ queryKey: getListLabelsQueryKey() });

  const create = useCreateLead({
    mutation: {
      onSuccess: async (lead) => {
        if (newLeadLabels.length > 0 && lead && typeof lead.id === "number") {
          await setLeadLabels.mutateAsync({ id: lead.id, data: { labelIds: newLeadLabels } });
        }
        toast({ title: "Lead added" });
        invalidateLeads();
        setOpen(false);
        setNewLeadLabels([]);
        form.reset();
      },
      onError: () => toast({ title: "Failed to add lead", variant: "destructive" }),
    },
  });

  const bulkImport = useBulkImportLeads({
    mutation: {
      onSuccess: (result) => {
        invalidateLeads();
        setImportResult(result);
      },
      onError: () => toast({ title: "Import failed", variant: "destructive" }),
    },
  });

  const remove = useDeleteLead({
    mutation: {
      onSuccess: () => {
        toast({ title: "Lead removed" });
        invalidateLeads();
      },
      onError: () => toast({ title: "Failed to remove lead", variant: "destructive" }),
    },
  });

  const setLeadLabels = useSetLeadLabels({
    mutation: {
      onSuccess: () => invalidateLeads(),
      onError: () => toast({ title: "Failed to update labels", variant: "destructive" }),
    },
  });

  const createLabel = useCreateLabel({
    mutation: {
      onSuccess: () => {
        toast({ title: "Label created" });
        invalidateLabels();
        setNewLabelName("");
      },
      onError: (err: Error) => toast({ title: "Failed to create label", description: err.message, variant: "destructive" }),
    },
  });

  const deleteLabel = useDeleteLabel({
    mutation: {
      onSuccess: () => {
        toast({ title: "Label deleted" });
        invalidateLabels();
        invalidateLeads();
      },
      onError: () => toast({ title: "Failed to delete label", variant: "destructive" }),
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", firstName: "", lastName: "", company: "", title: "" },
  });

  function onSubmit(values: FormValues) {
    create.mutate({ data: values });
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      setCsvText(evt.target?.result as string ?? "");
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function handleCsvImport() {
    if (!csvText.trim()) { toast({ title: "Paste or upload a CSV first", variant: "destructive" }); return; }
    bulkImport.mutate({ data: { leads: [], csvText, labelIds: importLabels.length > 0 ? importLabels : undefined } });
  }

  function closeCsvDialog() {
    setCsvOpen(false);
    setCsvText("");
    setImportResult(null);
    setImportLabels([]);
  }

  function toggleLabelOnLead(leadId: number, currentLabelIds: number[], labelId: number) {
    const next = currentLabelIds.includes(labelId)
      ? currentLabelIds.filter((id) => id !== labelId)
      : [...currentLabelIds, labelId];
    setLeadLabels.mutate({ id: leadId, data: { labelIds: next } });
  }

  function handleCreateLabel() {
    const name = newLabelName.trim();
    if (!name) return;
    createLabel.mutate({ data: { name, color: newLabelColor } });
  }

  const filtered = useMemo(() => {
    return (leads ?? []).filter((l) => {
      const s = search.toLowerCase();
      const matchesSearch = !s
        || l.email.toLowerCase().includes(s)
        || l.firstName?.toLowerCase().includes(s)
        || l.lastName?.toLowerCase().includes(s)
        || l.company?.toLowerCase().includes(s);
      if (!matchesSearch) return false;
      if (selectedFilterLabels.length === 0) return true;
      const leadLabelIds = new Set((l.labels ?? []).map((lbl: LabelLite) => lbl.id));
      return selectedFilterLabels.every((id) => leadLabelIds.has(id));
    });
  }, [leads, search, selectedFilterLabels]);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground mt-1">{leads?.length ?? 0} total leads</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setManageLabelsOpen(true)} data-testid="button-manage-labels">
            <Settings2 className="mr-2 h-4 w-4" /> Manage Labels
          </Button>
          <Button variant="outline" onClick={() => setCsvOpen(true)} data-testid="button-import-csv">
            <Upload className="mr-2 h-4 w-4" /> Import CSV
          </Button>
          <Button onClick={() => setOpen(true)} data-testid="button-add-lead">
            <Plus className="mr-2 h-4 w-4" /> Add Lead
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search leads..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-leads"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" data-testid="button-filter-labels">
              <Filter className="mr-2 h-4 w-4" />
              {selectedFilterLabels.length > 0 ? `${selectedFilterLabels.length} label${selectedFilterLabels.length > 1 ? "s" : ""}` : "Filter by label"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Filter by label</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {!labels?.length ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">No labels yet.</div>
            ) : labels.map(lbl => (
              <DropdownMenuCheckboxItem
                key={lbl.id}
                checked={selectedFilterLabels.includes(lbl.id)}
                onCheckedChange={(checked) => {
                  setSelectedFilterLabels(checked
                    ? [...selectedFilterLabels, lbl.id]
                    : selectedFilterLabels.filter(id => id !== lbl.id));
                }}
                data-testid={`filter-label-${lbl.id}`}
              >
                <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: lbl.color ?? "#06b6d4" }} />
                {lbl.name}
              </DropdownMenuCheckboxItem>
            ))}
            {selectedFilterLabels.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSelectedFilterLabels([])}>Clear filters</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Labels</TableHead>
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
                    <span className="text-sm">{search || selectedFilterLabels.length > 0 ? "No leads match your filters" : "No leads yet. Add your first lead to get started."}</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : filtered.map(lead => {
              const leadLabels: LabelLite[] = (lead.labels ?? []) as LabelLite[];
              const leadLabelIds = leadLabels.map(l => l.id);
              return (
                <TableRow
                  key={lead.id}
                  data-testid={`row-lead-${lead.id ?? 0}`}
                  className="cursor-pointer"
                  onClick={() => setSelectedLead(lead as Lead)}
                >
                  <TableCell className="font-medium">{lead.email}</TableCell>
                  <TableCell>{[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "—"}</TableCell>
                  <TableCell>{lead.company || "—"}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap items-center gap-1">
                      {leadLabels.map(lbl => <LabelChip key={lbl.id} label={lbl} />)}
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" data-testid={`button-edit-labels-${lead.id}`}>
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-56 p-2">
                          <p className="text-xs font-medium px-2 pb-1 text-muted-foreground">Assign labels</p>
                          {!labels?.length ? (
                            <div className="px-2 py-2 text-xs text-muted-foreground">
                              No labels yet. Create one using <span className="font-medium">Manage Labels</span>.
                            </div>
                          ) : (
                            <div className="max-h-48 overflow-y-auto">
                              {labels.map(lbl => (
                                <button
                                  key={lbl.id}
                                  type="button"
                                  onClick={() => toggleLabelOnLead(lead.id, leadLabelIds, lbl.id)}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent text-left"
                                  data-testid={`toggle-label-${lead.id}-${lbl.id}`}
                                >
                                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: lbl.color ?? "#06b6d4" }} />
                                  <span className="flex-1">{lbl.name}</span>
                                  {leadLabelIds.includes(lbl.id) && <CheckCircle2 className="h-3.5 w-3.5 text-cyan-500" />}
                                </button>
                              ))}
                            </div>
                          )}
                        </PopoverContent>
                      </Popover>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={(STATUS_COLORS[lead.status ?? "active"] ?? "secondary") as any}>{lead.status}</Badge>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
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
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Add single lead dialog */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setNewLeadLabels([]); }}>
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

              {labels && labels.length > 0 && (
                <div className="space-y-2">
                  <FormLabel>Labels</FormLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {labels.map(lbl => {
                      const selected = newLeadLabels.includes(lbl.id);
                      const color = lbl.color || "#06b6d4";
                      return (
                        <button
                          key={lbl.id}
                          type="button"
                          onClick={() => setNewLeadLabels(selected
                            ? newLeadLabels.filter(id => id !== lbl.id)
                            : [...newLeadLabels, lbl.id])}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border transition-opacity"
                          style={{
                            backgroundColor: selected ? `${color}33` : "transparent",
                            borderColor: `${color}66`,
                            color,
                            opacity: selected ? 1 : 0.6,
                          }}
                          data-testid={`new-lead-label-${lbl.id}`}
                        >
                          <Tag className="h-2.5 w-2.5" /> {lbl.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

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

      {/* CSV Import dialog */}
      <Dialog open={csvOpen} onOpenChange={closeCsvDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Import Leads from CSV</DialogTitle>
            <DialogDescription>
              Upload a CSV file or paste CSV text. Expected columns:{" "}
              <code className="text-xs bg-muted px-1 rounded">email</code>,{" "}
              <code className="text-xs bg-muted px-1 rounded">firstName</code>,{" "}
              <code className="text-xs bg-muted px-1 rounded">lastName</code>,{" "}
              <code className="text-xs bg-muted px-1 rounded">company</code>,{" "}
              <code className="text-xs bg-muted px-1 rounded">title</code>.
              Duplicates are skipped automatically.
            </DialogDescription>
          </DialogHeader>

          {importResult ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Import complete
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-md bg-card p-3">
                    <p className="text-2xl font-bold text-green-500">{importResult.imported}</p>
                    <p className="text-xs text-muted-foreground mt-1">Imported</p>
                  </div>
                  <div className="rounded-md bg-card p-3">
                    <p className="text-2xl font-bold text-yellow-500">{importResult.skipped}</p>
                    <p className="text-xs text-muted-foreground mt-1">Skipped</p>
                  </div>
                  <div className="rounded-md bg-card p-3">
                    <p className="text-2xl font-bold">{importResult.total}</p>
                    <p className="text-xs text-muted-foreground mt-1">Total</p>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={closeCsvDialog} data-testid="button-close-import">Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={handleFileUpload}
                  data-testid="input-csv-file"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-choose-file"
                >
                  <FileText className="mr-2 h-4 w-4" />
                  {csvText ? "File loaded — replace" : "Choose CSV file"}
                </Button>
              </div>
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-2 text-muted-foreground">or paste CSV</span></div>
              </div>
              <Textarea
                placeholder={"email,firstName,lastName,company,title\njohn@acme.com,John,Smith,Acme,CEO"}
                rows={8}
                value={csvText}
                onChange={e => setCsvText(e.target.value)}
                className="font-mono text-xs"
                data-testid="input-csv-text"
              />

              {labels && labels.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Assign labels to all imported leads <span className="text-muted-foreground font-normal">(optional)</span></p>
                  <div className="flex flex-wrap gap-1.5">
                    {labels.map(lbl => {
                      const selected = importLabels.includes(lbl.id);
                      const color = lbl.color || "#06b6d4";
                      return (
                        <button
                          key={lbl.id}
                          type="button"
                          onClick={() => setImportLabels(selected
                            ? importLabels.filter(id => id !== lbl.id)
                            : [...importLabels, lbl.id])}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border transition-opacity"
                          style={{
                            backgroundColor: selected ? `${color}33` : "transparent",
                            borderColor: `${color}66`,
                            color,
                            opacity: selected ? 1 : 0.6,
                          }}
                          data-testid={`import-label-${lbl.id}`}
                        >
                          <Tag className="h-2.5 w-2.5" /> {lbl.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeCsvDialog} data-testid="button-cancel-import">Cancel</Button>
                <Button
                  onClick={handleCsvImport}
                  disabled={bulkImport.isPending || !csvText.trim()}
                  data-testid="button-submit-import"
                >
                  {bulkImport.isPending ? "Importing..." : "Import Leads"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Manage Labels dialog */}
      <Dialog open={manageLabelsOpen} onOpenChange={setManageLabelsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage Labels</DialogTitle>
            <DialogDescription>Create labels to organize and segment your leads.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <FormLabel>New label</FormLabel>
              <div className="flex gap-2">
                <Input
                  placeholder="Label name (e.g. VIP, Q1 launch)"
                  value={newLabelName}
                  onChange={e => setNewLabelName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateLabel(); } }}
                  data-testid="input-new-label-name"
                />
                <Button type="button" onClick={handleCreateLabel} disabled={createLabel.isPending || !newLabelName.trim()} data-testid="button-create-label">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs text-muted-foreground">Color:</span>
                {LABEL_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewLabelColor(c)}
                    className="w-5 h-5 rounded-full border-2 transition-all"
                    style={{ backgroundColor: c, borderColor: newLabelColor === c ? "#fff" : "transparent" }}
                    aria-label={`Color ${c}`}
                  />
                ))}
              </div>
            </div>

            <div className="border-t border-border pt-3 space-y-1 max-h-64 overflow-y-auto">
              {!labels?.length ? (
                <p className="text-sm text-muted-foreground text-center py-4">No labels yet.</p>
              ) : labels.map(lbl => (
                <div key={lbl.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-accent" data-testid={`row-label-${lbl.id}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: lbl.color ?? "#06b6d4" }} />
                    <span className="text-sm truncate">{lbl.name}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => deleteLabel.mutate({ id: lbl.id })}
                    data-testid={`button-delete-label-${lbl.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageLabelsOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lead detail sheet */}
      <LeadDetailSheet
        lead={selectedLead}
        labels={labels}
        open={!!selectedLead}
        onOpenChange={(v) => { if (!v) setSelectedLead(null); }}
      />
    </div>
  );
}
