import type { DesktopLocalKnowledgeDocument, DesktopLocalSkill } from "@rakazo/contracts";
import { parseSkillMd } from "@rakazo/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@rakazo/ui-web";
import { ChevronLeft, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { LocalBot, LocalBridge } from "./types";
import { localErrorMessage } from "./types";

function sourceLabel(source: string): string {
  if (source === "managed") return "Managed";
  if (source === "builtin") return "Built-in";
  if (source === "user") return "Mine";
  return "Local";
}

function KnowledgePanel({ api, open }: { api: LocalBridge; open: boolean }) {
  const [documents, setDocuments] = useState<DesktopLocalKnowledgeDocument[] | null>(null);
  const [editing, setEditing] = useState<DesktopLocalKnowledgeDocument | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDocuments(null);
    setEditing(null);
    setError("");
    void api.knowledge
      .list()
      .then((next) => {
        if (!cancelled) setDocuments(next);
      })
      .catch((cause) => {
        if (!cancelled) setError(localErrorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [api, open]);

  function create() {
    setEditing("new");
    setTitle("");
    setContent("");
    setConfirmDelete(false);
    setError("");
  }

  function edit(document: DesktopLocalKnowledgeDocument) {
    setEditing(document);
    setTitle(document.title);
    setContent(document.content);
    setConfirmDelete(false);
    setError("");
  }

  async function save() {
    if (busy || !editing) return;
    setBusy(true);
    setError("");
    try {
      const saved =
        editing === "new"
          ? await api.knowledge.create({ title: title.trim(), content })
          : await api.knowledge.update(editing.id, { title: title.trim(), content });
      setDocuments((current) => {
        if (!current) return [saved];
        return current.some((document) => document.id === saved.id)
          ? current.map((document) => (document.id === saved.id ? saved : document))
          : [saved, ...current];
      });
      setEditing(saved);
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy || !editing || editing === "new") return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.knowledge.remove(editing.id);
      setDocuments((current) => current?.filter((document) => document.id !== editing.id) ?? []);
      setEditing(null);
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    const readOnly = editing !== "new" && editing.source === "managed";
    return (
      <div className="grid gap-3">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="-ms-2 me-auto"
          onClick={() => setEditing(null)}
        >
          <ChevronLeft size={13} />
          Knowledge
        </Button>
        <label
          htmlFor="local-knowledge-title"
          className="grid gap-1.5 text-[12px] text-muted-foreground"
        >
          Title
          <Input
            id="local-knowledge-title"
            value={title}
            maxLength={200}
            disabled={readOnly}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label
          htmlFor="local-knowledge-content"
          className="grid gap-1.5 text-[12px] text-muted-foreground"
        >
          Content
          <Textarea
            id="local-knowledge-content"
            value={content}
            rows={12}
            maxLength={500_000}
            disabled={readOnly}
            className="font-mono text-[12.5px]"
            onChange={(event) => setContent(event.target.value)}
          />
        </label>
        {readOnly ? (
          <p className="text-[11.5px] text-muted-foreground">
            Managed by your organization. Edit the source package to change it.
          </p>
        ) : null}
        {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
        {!readOnly ? (
          <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
            <Button
              type="button"
              disabled={busy || !title.trim() || !content.trim()}
              onClick={() => void save()}
            >
              {busy ? <LoaderCircle size={13} className="animate-spin" /> : null}
              {editing === "new" ? "Create" : "Save"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            {editing !== "new" ? (
              <Button
                type="button"
                variant="ghost"
                className="ms-auto text-destructive"
                disabled={busy}
                onClick={() => void remove()}
              >
                <Trash2 size={12} />
                {confirmDelete ? "Confirm delete" : "Delete"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={create}>
          <Plus size={13} />
          New document
        </Button>
      </div>
      {documents === null ? (
        <Skeleton className="h-14 w-full" />
      ) : documents.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-muted-foreground">
          No knowledge documents yet.
        </p>
      ) : (
        documents.map((document) => (
          <Button
            key={document.id}
            type="button"
            variant="ghost"
            className="h-auto w-full justify-start whitespace-normal rounded-xl border border-border px-3 py-2.5"
            onClick={() => edit(document)}
          >
            <span className="flex w-full items-start justify-between gap-3">
              <span className="min-w-0 text-start">
                <span className="block truncate text-[13.5px] text-foreground">
                  {document.title}
                </span>
                <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                  {document.content.slice(0, 120)}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {sourceLabel(document.source)}
              </span>
            </span>
          </Button>
        ))
      )}
      {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
    </div>
  );
}

function skillBody(skill: DesktopLocalSkill): string {
  const parsed = parseSkillMd(skill.content);
  return "error" in parsed ? skill.content : parsed.body;
}

function SkillsPanel({ api, open }: { api: LocalBridge; open: boolean }) {
  const [skills, setSkills] = useState<DesktopLocalSkill[] | null>(null);
  const [editing, setEditing] = useState<DesktopLocalSkill | "new" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSkills(null);
    setEditing(null);
    setError("");
    void api.skills
      .list()
      .then((next) => {
        if (!cancelled) setSkills(next);
      })
      .catch((cause) => {
        if (!cancelled) setError(localErrorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [api, open]);

  function create() {
    setEditing("new");
    setName("");
    setDescription("");
    setBody("");
    setConfirmDelete(false);
    setError("");
  }

  function edit(skill: DesktopLocalSkill) {
    setEditing(skill);
    setName(skill.name);
    setDescription(skill.description);
    setBody(skillBody(skill));
    setConfirmDelete(false);
    setError("");
  }

  async function save() {
    if (busy || !editing) return;
    setBusy(true);
    setError("");
    try {
      const saved =
        editing === "new"
          ? await api.skills.create({
              name: name.trim(),
              description: description.trim(),
              body,
            })
          : await api.skills.update(editing.name, {
              newName: name.trim(),
              description: description.trim(),
              body,
            });
      setSkills((current) => {
        if (!current) return [saved];
        const withoutSaved = current.filter(
          (skill) => skill.id !== saved.id && skill.id !== (editing === "new" ? "" : editing.id),
        );
        return [saved, ...withoutSaved];
      });
      setEditing(saved);
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy || !editing || editing === "new") return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.skills.remove(editing.name);
      setSkills((current) => current?.filter((skill) => skill.id !== editing.id) ?? []);
      setEditing(null);
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    const readOnly = editing !== "new" && editing.readOnly;
    return (
      <div className="grid gap-3">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="-ms-2 me-auto"
          onClick={() => setEditing(null)}
        >
          <ChevronLeft size={13} />
          Skills
        </Button>
        <label
          htmlFor="local-skill-name"
          className="grid gap-1.5 text-[12px] text-muted-foreground"
        >
          Name
          <Input
            id="local-skill-name"
            value={name}
            maxLength={80}
            disabled={readOnly}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label
          htmlFor="local-skill-description"
          className="grid gap-1.5 text-[12px] text-muted-foreground"
        >
          Description
          <Input
            id="local-skill-description"
            value={description}
            maxLength={2_000}
            disabled={readOnly}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label
          htmlFor="local-skill-body"
          className="grid gap-1.5 text-[12px] text-muted-foreground"
        >
          Instructions
          <Textarea
            id="local-skill-body"
            value={body}
            rows={11}
            maxLength={100_000}
            disabled={readOnly}
            className="font-mono text-[12.5px]"
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        {editing !== "new" ? (
          <p className="text-[11.5px] text-muted-foreground">
            Source: {sourceLabel(editing.source)}
          </p>
        ) : null}
        {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
        {!readOnly ? (
          <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
            <Button
              type="button"
              disabled={busy || !name.trim() || !description.trim()}
              onClick={() => void save()}
            >
              {busy ? <LoaderCircle size={13} className="animate-spin" /> : null}
              {editing === "new" ? "Create" : "Save"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            {editing !== "new" ? (
              <Button
                type="button"
                variant="ghost"
                className="ms-auto text-destructive"
                disabled={busy}
                onClick={() => void remove()}
              >
                <Trash2 size={12} />
                {confirmDelete ? "Confirm delete" : "Delete"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={create}>
          <Plus size={13} />
          New skill
        </Button>
      </div>
      {skills === null ? (
        <Skeleton className="h-14 w-full" />
      ) : (
        skills.map((skill) => (
          <Button
            key={skill.id}
            type="button"
            variant="ghost"
            className="h-auto w-full justify-start whitespace-normal rounded-xl border border-border px-3 py-2.5"
            onClick={() => edit(skill)}
          >
            <span className="flex w-full items-start justify-between gap-3">
              <span className="min-w-0 text-start">
                <span className="block truncate text-[13.5px] text-foreground">{skill.name}</span>
                <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                  {skill.description}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {sourceLabel(skill.source)}
              </span>
            </span>
          </Button>
        ))
      )}
      {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
    </div>
  );
}

export function LocalKnowledgeSkillsDialog({
  open,
  onOpenChange,
  api,
  bot: _bot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: LocalBridge;
  bot: LocalBot;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(820px,calc(100vh-3rem))] overflow-y-auto bg-background shadow-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Knowledge and skills</DialogTitle>
          <DialogDescription>
            Local reference documents and reusable SKILL.md instructions. Organization-managed items
            are read-only.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="knowledge">
          <TabsList aria-label="Knowledge and skills">
            <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
          </TabsList>
          <TabsContent value="knowledge">
            <KnowledgePanel api={api} open={open} />
          </TabsContent>
          <TabsContent value="skills">
            <SkillsPanel api={api} open={open} />
          </TabsContent>
        </Tabs>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}
