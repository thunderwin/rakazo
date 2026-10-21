import type { DesktopLocalMemoryDocument } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@rakazo/ui-web";
import { Download, LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { type LocalBot, type LocalBridge, localErrorMessage } from "./types";

type MemoryScope = "bot" | "user";

function downloadMarkdown(filename: string, documents: DesktopLocalMemoryDocument[]) {
  const markdown = documents.map((doc) => `# ${doc.path}\n\n${doc.content}`).join("\n\n");
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function MemoryList({
  documents,
  emptyText,
  busy,
  openId,
  draft,
  confirmingDelete,
  onOpen,
  onDraft,
  onSave,
  onCancel,
  onDelete,
}: {
  documents: DesktopLocalMemoryDocument[];
  emptyText: string;
  busy: boolean;
  openId: string | null;
  draft: string;
  confirmingDelete: boolean;
  onOpen: (document: DesktopLocalMemoryDocument) => void;
  onDraft: (value: string) => void;
  onSave: (document: DesktopLocalMemoryDocument) => void;
  onCancel: () => void;
  onDelete: (document: DesktopLocalMemoryDocument) => void;
}) {
  if (documents.length === 0) {
    return <p className="py-8 text-center text-[13px] text-muted-foreground">{emptyText}</p>;
  }
  return (
    <div className="grid gap-1">
      {documents.map((document) => {
        const isOpen = openId === document.id;
        return (
          <div key={document.id} className="rounded-lg">
            <Button
              type="button"
              variant="ghost"
              className={`h-auto w-full justify-start whitespace-normal px-2.5 py-2.5 ${
                isOpen ? "bg-muted" : ""
              }`}
              onClick={() => (isOpen ? onCancel() : onOpen(document))}
            >
              <span className="flex w-full items-baseline justify-between gap-3">
                <span
                  className="min-w-0 truncate text-start text-[13px] text-foreground"
                  dir="auto"
                >
                  {document.path}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  rev {document.revision}
                </span>
              </span>
            </Button>
            {isOpen ? (
              <div className="px-2.5 pb-2.5">
                <Textarea
                  aria-label={document.path}
                  value={draft}
                  disabled={busy}
                  rows={Math.min(16, Math.max(5, draft.split("\n").length + 1))}
                  className="mt-1 w-full font-mono text-[12.5px] leading-relaxed"
                  dir="auto"
                  onChange={(event) => onDraft(event.target.value)}
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || draft === document.content}
                    onClick={() => onSave(document)}
                  >
                    {busy ? <LoaderCircle size={12} className="animate-spin" /> : null}
                    Save
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={onCancel}
                  >
                    Cancel
                  </Button>
                  {document.path !== "MEMORY.md" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      className="ms-auto text-destructive"
                      onClick={() => onDelete(document)}
                    >
                      <Trash2 size={12} />
                      {confirmingDelete ? "Confirm delete" : "Delete"}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function LocalMemoryDialog({
  open,
  onOpenChange,
  api,
  bot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: LocalBridge;
  bot: LocalBot;
}) {
  const [documents, setDocuments] = useState<DesktopLocalMemoryDocument[] | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function fetchDocuments() {
    const next = await Promise.all([
      api.memory.list({ botId: bot.id, scope: "bot" }),
      api.memory.list({ scope: "user" }),
    ]);
    return next.flat();
  }

  async function loadDocuments() {
    const all = await fetchDocuments();
    setDocuments(all);
    return all;
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDocuments(null);
    setError("");
    setOpenId(null);
    setDraft("");
    setConfirmingDelete(false);
    void fetchDocuments()
      .then((next) => {
        if (!cancelled) setDocuments(next);
      })
      .catch((cause) => {
        if (!cancelled) setError(localErrorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [api, bot.id, open]);

  function selectScope(scope: MemoryScope) {
    return documents?.filter((document) => document.scope === scope) ?? [];
  }

  function openDocument(document: DesktopLocalMemoryDocument) {
    setOpenId(document.id);
    setDraft(document.content);
    setConfirmingDelete(false);
    setError("");
  }

  function closeDocument() {
    setOpenId(null);
    setDraft("");
    setConfirmingDelete(false);
  }

  async function save(document: DesktopLocalMemoryDocument) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api.memory.update(document.id, draft, document.revision);
      setDocuments(
        (current) =>
          current?.map((entry) => (entry.id === updated.id ? updated : entry)) ?? [updated],
      );
      closeDocument();
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(document: DesktopLocalMemoryDocument) {
    if (busy) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.memory.remove(document.id);
      setDocuments((current) => current?.filter((entry) => entry.id !== document.id) ?? []);
      closeDocument();
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function exportDocuments(scope: MemoryScope) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const all = await loadDocuments();
      downloadMarkdown(
        scope === "bot" ? "bot-memory.md" : "shared-memory.md",
        all.filter((document) => document.scope === scope),
      );
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const listProps = {
    busy,
    openId,
    draft,
    confirmingDelete,
    onOpen: openDocument,
    onDraft: setDraft,
    onSave: (document: DesktopLocalMemoryDocument) => void save(document),
    onCancel: closeDocument,
    onDelete: (document: DesktopLocalMemoryDocument) => void remove(document),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(760px,calc(100vh-3rem))] overflow-y-auto bg-background shadow-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Memory</DialogTitle>
          <DialogDescription>
            Bot memory and shared documents stay on this device and may be included in model
            requests.
          </DialogDescription>
        </DialogHeader>

        {documents === null && !error ? (
          <div className="grid gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <Tabs defaultValue="bot">
            <TabsList aria-label="Memory scope">
              <TabsTrigger value="bot">This bot</TabsTrigger>
              <TabsTrigger value="user">Shared</TabsTrigger>
            </TabsList>
            <TabsContent value="bot">
              <MemoryList
                documents={selectScope("bot")}
                emptyText="Nothing remembered yet."
                {...listProps}
              />
              {selectScope("bot").length ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void exportDocuments("bot")}
                >
                  <Download size={12} />
                  Download as Markdown
                </Button>
              ) : null}
            </TabsContent>
            <TabsContent value="user">
              <MemoryList
                documents={selectScope("user")}
                emptyText="No shared documents yet."
                {...listProps}
              />
              {selectScope("user").length ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void exportDocuments("user")}
                >
                  <Download size={12} />
                  Download as Markdown
                </Button>
              ) : null}
            </TabsContent>
          </Tabs>
        )}

        {error ? (
          <p role="alert" className="text-[12.5px] text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}
