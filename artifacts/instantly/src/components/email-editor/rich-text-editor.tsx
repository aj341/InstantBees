import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Separator } from "@/components/ui/separator";
import {
  Bold, Italic, List, ListOrdered, Link as LinkIcon,
  Heading2, Quote, Undo, Redo, Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}

export function RichTextEditor({ value, onChange, placeholder, className }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "min-h-[180px] px-3 py-2 text-sm focus:outline-none",
        "data-placeholder": placeholder ?? "",
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
  });

  if (!editor) return null;

  function setLink() {
    const url = window.prompt("URL:", editor?.getAttributes("link").href ?? "https://");
    if (url === null) return;
    if (url === "") { editor?.chain().focus().extendMarkRange("link").unsetLink().run(); return; }
    editor?.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  const btnClass = "h-7 w-7 p-0";
  const activeClass = "bg-accent text-accent-foreground";

  return (
    <div className={cn("rounded-md border border-input bg-background overflow-hidden", className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1 bg-muted/30">
        <Button
          type="button" variant="ghost" size="icon"
          className={cn(btnClass, editor.isActive("bold") && activeClass)}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold"
        ><Bold className="h-3.5 w-3.5" /></Button>

        <Button
          type="button" variant="ghost" size="icon"
          className={cn(btnClass, editor.isActive("italic") && activeClass)}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic"
        ><Italic className="h-3.5 w-3.5" /></Button>

        <Separator orientation="vertical" className="h-5 mx-1" />

        <Button
          type="button" variant="ghost" size="icon"
          className={cn(btnClass, editor.isActive("heading", { level: 2 }) && activeClass)}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          title="Heading"
        ><Heading2 className="h-3.5 w-3.5" /></Button>

        <Button
          type="button" variant="ghost" size="icon"
          className={cn(btnClass, editor.isActive("blockquote") && activeClass)}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title="Quote"
        ><Quote className="h-3.5 w-3.5" /></Button>

        <Separator orientation="vertical" className="h-5 mx-1" />

        <Button
          type="button" variant="ghost" size="icon"
          className={cn(btnClass, editor.isActive("bulletList") && activeClass)}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bullet list"
        ><List className="h-3.5 w-3.5" /></Button>

        <Button
          type="button" variant="ghost" size="icon"
          className={cn(btnClass, editor.isActive("orderedList") && activeClass)}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Ordered list"
        ><ListOrdered className="h-3.5 w-3.5" /></Button>

        <Separator orientation="vertical" className="h-5 mx-1" />

        <Button
          type="button" variant="ghost" size="icon"
          className={cn(btnClass, editor.isActive("link") && activeClass)}
          onClick={setLink}
          title="Insert link"
        ><LinkIcon className="h-3.5 w-3.5" /></Button>

        <Button
          type="button" variant="ghost" size="icon"
          className={btnClass}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Divider"
        ><Minus className="h-3.5 w-3.5" /></Button>

        <Separator orientation="vertical" className="h-5 mx-1" />

        <Button
          type="button" variant="ghost" size="icon"
          className={btnClass}
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo"
        ><Undo className="h-3.5 w-3.5" /></Button>

        <Button
          type="button" variant="ghost" size="icon"
          className={btnClass}
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo"
        ><Redo className="h-3.5 w-3.5" /></Button>
      </div>

      {/* Editor */}
      <EditorContent
        editor={editor}
        className="prose prose-sm prose-invert max-w-none [&_.ProseMirror]:min-h-[180px] [&_.ProseMirror]:px-3 [&_.ProseMirror]:py-2 [&_.ProseMirror]:focus:outline-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0"
      />
    </div>
  );
}
