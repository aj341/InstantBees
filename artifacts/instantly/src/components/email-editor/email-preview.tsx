import { useState, useMemo } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmailPreviewProps {
  body: string;
  bodyType: "text" | "html";
  subject?: string;
  className?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/**
 * Mirrors the server's wrapPlainTextAsHtml in mailer.ts so the preview
 * matches how a plain-text body actually renders in Gmail/Outlook after send.
 */
function wrapPlainTextAsHtml(text: string): string {
  const escaped = escapeHtml(text);
  const paragraphs = escaped.split(/\n{2,}/).map((p) => p.replace(/\n/g, "<br />"));
  return paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 1em 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.5;color:#222;">${p}</p>`,
    )
    .join("");
}

function buildDocument(body: string, bodyType: "text" | "html"): string {
  const inner = bodyType === "text" ? wrapPlainTextAsHtml(body) : body;
  // If the source is a full HTML document, use it as-is. Otherwise wrap so the
  // background and base typography match what a real email client renders.
  if (/<!doctype|<html|<head|<body/i.test(inner)) return inner;
  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body { margin: 0; padding: 24px; background: #ffffff; color: #222; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; font-size: 14px; line-height: 1.5; word-wrap: break-word; }
  a { color: #1a73e8; }
  img { max-width: 100%; height: auto; }
</style>
</head><body>${inner}</body></html>`;
}

export function EmailPreview({ body, bodyType, subject, className }: EmailPreviewProps) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  const doc = useMemo(() => buildDocument(body, bodyType), [body, bodyType]);

  const widthClass = device === "mobile" ? "w-[375px]" : "w-full max-w-[640px]";

  return (
    <div className={cn("rounded-md border border-input bg-muted/20", className)}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="text-xs text-muted-foreground">
          Preview <span className="opacity-60">— approximate</span>
        </div>
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5">
          <button
            type="button"
            onClick={() => setDevice("desktop")}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-1 text-xs",
              device === "desktop" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            data-testid="preview-device-desktop"
            title="Desktop"
          >
            <Monitor className="h-3 w-3" /> Desktop
          </button>
          <button
            type="button"
            onClick={() => setDevice("mobile")}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-1 text-xs",
              device === "mobile" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            data-testid="preview-device-mobile"
            title="Mobile"
          >
            <Smartphone className="h-3 w-3" /> Mobile
          </button>
        </div>
      </div>
      <div className="flex justify-center bg-muted/10 py-4">
        <div className={cn("rounded-md border border-border bg-white shadow-sm transition-all", widthClass)}>
          {subject && (
            <div className="border-b border-border px-4 py-2 text-sm font-medium text-gray-700">
              {subject}
            </div>
          )}
          <iframe
            title="Email preview"
            sandbox=""
            srcDoc={doc}
            className="block w-full"
            style={{ minHeight: 320, height: device === "mobile" ? 560 : 480, border: "none" }}
            data-testid="email-preview-iframe"
          />
        </div>
      </div>
    </div>
  );
}
