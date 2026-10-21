import { Button, Skeleton } from "@rakazo/ui-web";
import { Download, FileText, ImageOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { LocalBridge, LocalMessageBlock } from "./types";

type ArtifactBlock = Extract<LocalMessageBlock, { kind: "image" | "file" }>;

function formatBytes(size: number): string {
  if (size < 1_024) return `${size} B`;
  if (size < 1_024 * 1_024) return `${(size / 1_024).toFixed(1)} KB`;
  return `${(size / (1_024 * 1_024)).toFixed(1)} MB`;
}

function downloadBase64(name: string, mimeType: string, contentBase64: string) {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function LocalAttachmentView({ block, api }: { block: ArtifactBlock; api: LocalBridge }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const image = block.kind === "image";

  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    void api.artifacts
      .read(block.artifactId)
      .then((artifact) => {
        if (!cancelled) {
          if (artifact) setContent(artifact.contentBase64);
          else setError("Attachment not found");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not load attachment");
      });
    return () => {
      cancelled = true;
    };
  }, [api, block.artifactId, image]);

  async function download() {
    setError("");
    try {
      const artifact = content ? null : await api.artifacts.read(block.artifactId);
      const contentBase64 = content ?? artifact?.contentBase64;
      if (!contentBase64) throw new Error("Attachment not found");
      downloadBase64(block.name, block.mimeType, contentBase64);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not download attachment");
    }
  }

  if (image) {
    return (
      <figure className="mt-1 max-w-sm overflow-hidden rounded-2xl border border-border bg-card">
        {content ? (
          <img
            src={`data:${block.mimeType};base64,${content}`}
            alt={block.name}
            className="max-h-64 w-full object-contain"
          />
        ) : error ? (
          <div className="flex items-center gap-2 px-3 py-5 text-[12px] text-muted-foreground">
            <ImageOff size={16} />
            {error}
          </div>
        ) : (
          <Skeleton className="h-36 w-72 max-w-full" />
        )}
        <figcaption className="flex items-center gap-2 px-3 py-2 text-[11.5px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{block.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Download ${block.name}`}
            onClick={() => void download()}
          >
            <Download size={13} />
          </Button>
        </figcaption>
      </figure>
    );
  }

  return (
    <div className="mt-1">
      <div className="flex min-w-[240px] max-w-sm items-center gap-2.5 rounded-2xl border border-border bg-card px-3 py-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
          <FileText size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium">{block.name}</span>
          <span className="block text-[10.5px] text-muted-foreground">
            {block.mimeType} · {formatBytes(block.size)}
          </span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Download ${block.name}`}
          onClick={() => void download()}
        >
          <Download size={13} />
        </Button>
      </div>
      {error ? <p className="mt-1 text-[11px] text-destructive">{error}</p> : null}
    </div>
  );
}
