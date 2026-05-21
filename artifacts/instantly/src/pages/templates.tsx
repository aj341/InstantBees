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
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Trash2, FileText, Code2, Type } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { RichTextEditor } from "@/components/email-editor/rich-text-editor";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Body is required"),
  bodyType: z.enum(["text", "html"]).default("text"),
});

type FormValues = z.infer<typeof schema>;

type Template = {
  id: number;
  name: string;
  subject: string;
  body: string;
  bodyType: string;
  createdAt: string;
};

export default function Templates() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);

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
    defaultValues: { name: "", subject: "", body: "", bodyType: "text" },
  });

  const watchedBodyType = form.watch("bodyType");

  function openCreate() {
    setEditingTemplate(null);
    form.reset({ name: "", subject: "", body: "", bodyType: "text" });
    setDialogOpen(true);
  }

  function openEdit(t: Template) {
    setEditingTemplate(t);
    form.reset({ name: t.name, subject: t.subject, body: t.body, bodyType: (t.bodyType as "text" | "html") ?? "text" });
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Edit Template" : "New Template"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
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

              <FormField control={form.control} name="bodyType" render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Body</FormLabel>
                    <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5">
                      <button
                        type="button"
                        onClick={() => field.onChange("text")}
                        className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${field.value === "text" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        data-testid="toggle-template-text"
                      >
                        <Type className="h-3 w-3" /> Plain Text
                      </button>
                      <button
                        type="button"
                        onClick={() => field.onChange("html")}
                        className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${field.value === "html" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        data-testid="toggle-template-html"
                      >
                        <Code2 className="h-3 w-3" /> Rich HTML
                      </button>
                    </div>
                  </div>
                </FormItem>
              )} />

              <FormField control={form.control} name="body" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    {watchedBodyType === "html" ? (
                      <RichTextEditor
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Write your email body here... Use {{firstName}}, {{company}}, etc. for personalization."
                        data-testid="input-template-body"
                      />
                    ) : (
                      <Textarea
                        placeholder={"Hi {{firstName}},\n\nI noticed {{company}} recently...\n\nBest,\n{{senderName}}"}
                        rows={8}
                        data-testid="input-template-body"
                        {...field}
                      />
                    )}
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <DialogFooter>
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
