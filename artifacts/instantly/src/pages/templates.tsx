import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTemplates,
  useCreateTemplate,
  useUpdateTemplate,
  useDeleteTemplate,
  getListTemplatesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle, CheckCircle2, Plus, Pencil, Trash2, FileText, Code2, Type, Braces } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { RichTextEditor } from "@/components/email-editor/rich-text-editor";
import { EmailPreview } from "@/components/email-editor/email-preview";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  subject: z.string().min(1, "Subject is required"),
  previewText: z.string().optional(),
  body: z.string().min(1, "Body is required"),
  bodyType: z.enum(["text", "html"]).default("text"),
});

type FormValues = z.infer<typeof schema>;

type Template = {
  id: number;
  name: string;
  subject: string;
  previewText?: string | null;
  body: string;
  bodyType: string;
  createdAt: string;
};

const APPROVED_MERGE_TAGS = new Set([
  "firstName",
  "lastName",
  "company",
  "title",
  "role_title",
  "roleTitle",
  "email",
  "linkedinUrl",
]);

function mergeTagsFrom(value: string): string[] {
  return Array.from(value.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g)).map((match) => match[1] ?? "");
}

export default function Templates() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [editorMode, setEditorMode] = useState<"text" | "rich" | "source">("text");

  function inferEditorMode(body: string, bodyType: string): "text" | "rich" | "source" {
    if (bodyType !== "html") return "text";
    if (/<!doctype|<html|<head|<style|<body/i.test(body)) return "source";
    return "rich";
  }

  function setMode(mode: "text" | "rich" | "source") {
    setEditorMode(mode);
    form.setValue("bodyType", mode === "text" ? "text" : "html");
  }

  const { data: templates, isLoading } = useListTemplates({ query: { queryKey: getListTemplatesQueryKey() } });

  const create = useCreateTemplate({
    mutation: {
      onSuccess: () => {
        toast({ title: "Template created" });
        queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
        closeDialog();
      },
      onError: () => toast({ title: "Failed to create template", variant: "destructive" }),
    },
  });

  const update = useUpdateTemplate({
    mutation: {
      onSuccess: () => {
        toast({ title: "Template updated" });
        queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
        closeDialog();
      },
      onError: () => toast({ title: "Failed to update template", variant: "destructive" }),
    },
  });

  const del = useDeleteTemplate({
    mutation: {
      onSuccess: () => {
        toast({ title: "Template deleted" });
        queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
      },
      onError: () => toast({ title: "Failed to delete template", variant: "destructive" }),
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", subject: "", previewText: "", body: "", bodyType: "text" },
  });

  function openCreate() {
    setEditingTemplate(null);
    form.reset({ name: "", subject: "", previewText: "", body: "", bodyType: "text" });
    setEditorMode("text");
    setDialogOpen(true);
  }

  function openEdit(t: Template) {
    setEditingTemplate(t);
    const bt = (t.bodyType as "text" | "html") ?? "text";
    form.reset({ name: t.name, subject: t.subject, previewText: t.previewText ?? "", body: t.body, bodyType: bt });
    setEditorMode(inferEditorMode(t.body, bt));
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingTemplate(null);
    form.reset();
  }

  function onSubmit(values: FormValues) {
    if (editingTemplate) {
      update.mutate({ id: editingTemplate.id, data: values });
    } else {
      create.mutate({ data: values });
    }
  }

  const watchedBody = form.watch("body") || "";
  const watchedSubject = form.watch("subject") || "";
  const mergeTags = Array.from(new Set([...mergeTagsFrom(watchedSubject), ...mergeTagsFrom(watchedBody)]));
  const unknownTags = mergeTags.filter((tag) => !APPROVED_MERGE_TAGS.has(tag) && !tag.startsWith("customFields."));

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Email Templates</h1>
          <p className="text-sm text-muted-foreground">Reusable email templates you can load into any campaign sequence step</p>
        </div>
        <Button onClick={openCreate} data-testid="button-new-template">
          <Plus className="mr-2 h-4 w-4" /> New Template
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading templates...</p>
      ) : !templates?.length ? (
        <div className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
          <FileText className="h-10 w-10 opacity-20" />
          <p className="text-sm">No templates yet. Create one to reuse across campaigns.</p>
          <Button variant="outline" size="sm" onClick={openCreate}>Create your first template</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <Card key={t.id} data-testid={`card-template-${t.id}`}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold truncate">{t.name}</p>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                        {t.bodyType === "html" ? (
                          <><Code2 className="h-2.5 w-2.5 mr-1" />HTML</>
                        ) : (
                          <><Type className="h-2.5 w-2.5 mr-1" />Plain Text</>
                        )}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      <span className="font-medium text-foreground/70">Subject:</span> {t.subject}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {t.bodyType === "html"
                        ? t.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
                        : t.body}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(t)} data-testid={`button-edit-template-${t.id}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => del.mutate({ id: t.id })}
                      data-testid={`button-delete-template-${t.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(v) => { if (!v) closeDialog(); }}>
        <DialogContent className="w-[min(1400px,95vw)] max-w-none flex flex-col max-h-[92vh]">
          <DialogHeader className="shrink-0">
            <DialogTitle>{editingTemplate ? "Edit Template" : "New Template"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
              <div className="grid flex-1 min-h-0 gap-4 pr-1 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.95fr)]">
                <div className="flex min-w-0 min-h-0 flex-col gap-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField control={form.control} name="name" render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>Template Name</FormLabel>
                        <FormControl><Input placeholder="e.g. Cold intro email" data-testid="input-template-name" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={form.control} name="subject" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Subject Line</FormLabel>
                        <FormControl><Input placeholder="e.g. Quick question about {{company}}" data-testid="input-template-subject" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={form.control} name="previewText" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Preview Text <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                        <FormControl><Input placeholder="Short snippet shown next to the subject in the inbox preview" data-testid="input-template-preview-text" {...field} value={field.value ?? ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <div className="rounded-md border border-border bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {unknownTags.length === 0 ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <AlertTriangle className="h-4 w-4 text-amber-400" />}
                        Merge tags
                      </div>
                      <Badge variant={unknownTags.length === 0 ? "secondary" : "outline"}>
                        {mergeTags.length} used
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {["{{firstName}}", "{{company}}", "{{role_title}}", "{{customFields.hook}}", "{{linkedinUrl}}"].map((tag) => (
                        <span key={tag} className="rounded border border-border bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground">{tag}</span>
                      ))}
                    </div>
                    {unknownTags.length > 0 && (
                      <p className="mt-2 text-xs text-amber-300">
                        Check unknown tag{unknownTags.length === 1 ? "" : "s"}: {unknownTags.map((tag) => `{{${tag}}}`).join(", ")}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>Body</Label>
                    <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5">
                      <button
                        type="button"
                        onClick={() => setMode("text")}
                        className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${editorMode === "text" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        data-testid="toggle-template-text"
                      >
                        <Type className="h-3 w-3" /> Plain Text
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode("rich")}
                        className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${editorMode === "rich" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        data-testid="toggle-template-html"
                      >
                        <Code2 className="h-3 w-3" /> Rich HTML
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode("source")}
                        className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${editorMode === "source" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        data-testid="toggle-template-source"
                      >
                        <Braces className="h-3 w-3" /> HTML Source
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 min-h-0 rounded-md border border-border bg-card p-3">
                    <FormField control={form.control} name="body" render={({ field }) => (
                      <FormItem className="flex h-full min-h-0 flex-col">
                        <FormControl className="flex-1 min-h-0">
                          {editorMode === "rich" ? (
                            <RichTextEditor
                              value={field.value}
                              onChange={field.onChange}
                              placeholder="Write your email body here... Use {{firstName}}, {{company}}, etc. for personalization."
                              data-testid="input-template-body"
                            />
                          ) : editorMode === "source" ? (
                            <Textarea
                              placeholder={"<!DOCTYPE html>\n<html>\n  <body>\n    Hi {{firstName}}, ...\n  </body>\n</html>"}
                              className="h-full min-h-[360px] font-mono text-xs leading-relaxed resize-none"
                              data-testid="input-template-body"
                              {...field}
                            />
                          ) : (
                            <Textarea
                              placeholder={"Hi {{firstName}},\n\nI noticed {{company}} recently...\n\nBest,\n{{senderName}}"}
                              className="h-full min-h-[360px] resize-none"
                              data-testid="input-template-body"
                              {...field}
                            />
                          )}
                        </FormControl>
                        {editorMode === "source" && (
                          <p className="text-xs text-muted-foreground mt-2">Paste raw HTML. It will be sent exactly as written.</p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
                <div className="min-w-0 min-h-0">
                  <EmailPreview
                    body={form.watch("body") || ""}
                    bodyType={editorMode === "text" ? "text" : "html"}
                    subject={form.watch("subject") || undefined}
                    previewText={form.watch("previewText") || undefined}
                    className="h-full"
                  />
                </div>
              </div>
              <DialogFooter className="shrink-0 pt-4 border-t border-border mt-2">
                <Button type="button" variant="outline" onClick={closeDialog} data-testid="button-cancel-template">Cancel</Button>
                <Button type="submit" disabled={create.isPending || update.isPending} data-testid="button-submit-template">
                  {editingTemplate ? "Save Changes" : "Create Template"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
