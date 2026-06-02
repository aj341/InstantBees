import { useState, useMemo } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmailPreviewProps {
  body: string;
  bodyType: "text" | "html";
  subject?: string;
  previewText?: string;
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
        `<p style="margin:0 0 1em 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.5;color:#222;white-space:normal;overflow-wrap:anywhere;word-break:normal;">${p}</p>`,
    )
    .join("");
}

const MOBILE_PREVIEW_CSS = `
<style data-preview-mobile="true">
  html, body { width: 100% !important; min-width: 0 !important; overflow-x: hidden !important; }
  body { margin-left: 0 !important; margin-right: 0 !important; }
  body, p, div, span, td, th, a {
    max-width: 100% !important;
    white-space: normal !important;
    overflow-wrap: anywhere !important;
    word-break: normal !important;
  }
  table, tbody, tr, td, th { box-sizing: border-box !important; }
  table { width: 100% !important; max-width: 100% !important; table-layout: auto !important; }
  table[width], table[style*="width:"] { width: 100% !important; max-width: 100% !important; }
  [width="500"], [width="540"], [width="600"], [style*="width:500px"], [style*="width:540px"], [style*="width:600px"], .container {
    width: 100% !important;
    max-width: 100% !important;
  }
  td[width="33.33%"], td[width="50%"], td[width="210"], td[width="220"] {
    display: block !important;
    width: 100% !important;
    max-width: 100% !important;
    padding-left: 0 !important;
    padding-right: 0 !important;
  }
  td[style*="padding:"] { max-width: 100% !important; }
  img { max-width: 100% !important; height: auto !important; }
</style>`;

function addMobilePreviewCss(doc: string): string {
  if (/<\/head>/i.test(doc)) return doc.replace(/<\/head>/i, `${MOBILE_PREVIEW_CSS}</head>`);
  return doc.replace(/<body/i, `<head>${MOBILE_PREVIEW_CSS}</head><body`);
}

function buildDocument(body: string, bodyType: "text" | "html", device: "desktop" | "mobile"): string {
  const inner = bodyType === "text" ? wrapPlainTextAsHtml(body) : body;
  // If the source is a full HTML document, use it as-is. Otherwise wrap so the
  // background and base typography match what a real email client renders.
  if (/<!doctype|<html|<head|<body/i.test(inner)) {
    return device === "mobile" ? addMobilePreviewCss(inner) : inner;
  }
  const doc = `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  * { box-sizing: border-box; }
  html, body { width: 100%; min-width: 0; overflow-x: hidden; }
  body { margin: 0; padding: 24px; background: #ffffff; color: #222; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; word-break: normal; }
  p, div, span, td, th, a { max-width: 100%; overflow-wrap: anywhere; word-break: normal; }
  a { color: #1a73e8; }
  img { max-width: 100%; height: auto; }
</style>
</head><body>${inner}</body></html>`;
  return device === "mobile" ? addMobilePreviewCss(doc) : doc;
}

export function EmailPreview({ body, bodyType, subject, previewText, className }: EmailPreviewProps) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  const doc = useMemo(() => buildDocument(body, bodyType, device), [body, bodyType, device]);

  const previewFrameStyle = device === "mobile"
    ? { width: 375, maxWidth: "100%" }
    : { width: "100%", maxWidth: 640 };

  return (
    <div className={cn("flex flex-col rounded-md border border-input bg-muted/20 overflow-hidden", className)}>
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
      <div className="flex flex-1 justify-center bg-muted/10 p-4 overflow-auto">
        <div
          className="rounded-md border border-border bg-white shadow-sm transition-all overflow-hidden"
          style={previewFrameStyle}
        >
          {(subject || previewText) && (
            <div className="border-b border-border px-4 py-2">
              {subject && (
                <div className="text-sm font-medium text-gray-700">{subject}</div>
              )}
              {previewText && (
                <div className="text-xs text-gray-500 mt-0.5 line-clamp-1" title={previewText}>
                  {previewText}
                </div>
              )}
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
