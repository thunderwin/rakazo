import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type {
  DesktopLocalKnowledgeDocument,
  DesktopLocalSkill,
  DesktopLocalSkillScriptInput,
} from "@rakazo/contracts";
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
import { i18n } from "../lib/i18n";
import type { LocalBridge } from "./types";
import { localErrorMessage } from "./types";

function sourceLabel(source: string): string {
  if (source === "managed") return i18n._(msg`Managed`);
  if (source === "builtin") return i18n._(msg`Built-in`);
  if (source === "user") return i18n._(msg`Mine`);
  return i18n._(msg`Local`);
}

function KnowledgePanel({ api, open }: { api: LocalBridge; open: boolean }) {
  const { t } = useLingui();
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
          <Trans>Knowledge</Trans>
        </Button>
        <label
          htmlFor="local-knowledge-title"
          className="grid gap-1.5 text-[12px] text-muted-foreground"
        >
          <Trans>Title</Trans>
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
          <Trans>Content</Trans>
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
            <Trans>Managed by your organization. Edit the source package to change it.</Trans>
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
              {editing === "new" ? t`Create` : t`Save`}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              <Trans>Cancel</Trans>
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
                {confirmDelete ? t`Confirm delete` : t`Delete`}
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
          <Trans>New document</Trans>
        </Button>
      </div>
      {documents === null ? (
        <Skeleton className="h-14 w-full" />
      ) : documents.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-muted-foreground">
          <Trans>No knowledge documents yet.</Trans>
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

type ScriptDraft = {
  path: string;
  content: string;
  runtime: "auto" | "none" | "node" | "python3" | "sh";
  timeoutSeconds: number;
  network: boolean;
};

function scriptDrafts(skill: DesktopLocalSkill): ScriptDraft[] {
  return skill.scripts.map((script) => ({
    path: script.path,
    content: script.content,
    runtime: script.runtime ?? "none",
    timeoutSeconds: script.timeoutSeconds,
    network: script.network,
  }));
}

function scriptInputs(scripts: ScriptDraft[]): DesktopLocalSkillScriptInput[] {
  return scripts.map((script) => ({
    path: script.path,
    content: script.content,
    runtime:
      script.runtime === "auto" ? undefined : script.runtime === "none" ? null : script.runtime,
    timeoutSeconds: script.timeoutSeconds,
    network: script.network,
  }));
}

function SkillsPanel({ api, open }: { api: LocalBridge; open: boolean }) {
  const { t } = useLingui();
  const [skills, setSkills] = useState<DesktopLocalSkill[] | null>(null);
  const [editing, setEditing] = useState<DesktopLocalSkill | "new" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [scripts, setScripts] = useState<ScriptDraft[]>([]);
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
    setScripts([]);
    setConfirmDelete(false);
    setError("");
  }

  function edit(skill: DesktopLocalSkill) {
    setEditing(skill);
    setName(skill.name);
    setDescription(skill.description);
    setBody(skillBody(skill));
    setScripts(scriptDrafts(skill));
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
              scripts: scriptInputs(scripts),
            })
          : await api.skills.update(editing.name, {
              newName: name.trim(),
              description: description.trim(),
              body,
              scripts: scriptInputs(scripts),
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
          <Trans>Skills</Trans>
        </Button>
        <label
          htmlFor="local-skill-name"
          className="grid gap-1.5 text-[12px] text-muted-foreground"
        >
          <Trans>Name</Trans>
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
          <Trans>Description</Trans>
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
          <Trans>Instructions</Trans>
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
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[12px] font-medium text-foreground">
                <Trans>Scripts</Trans>
              </p>
              <p className="text-[11px] text-muted-foreground">
                <Trans>
                  Entrypoints receive input.json and run in a fresh folder under skill-runs/.
                </Trans>
              </p>
            </div>
            {!readOnly ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setScripts((current) => [
                    ...current,
                    {
                      path: "scripts/main.js",
                      content:
                        'const fs = require("node:fs");\nconst input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));\nconsole.log(input);\n',
                      runtime: "auto",
                      timeoutSeconds: 60,
                      network: false,
                    },
                  ])
                }
              >
                <Plus size={12} />
                <Trans>Add script</Trans>
              </Button>
            ) : null}
          </div>
          {scripts.map((script, index) => (
            <div
              key={`${script.path}:${index}`}
              className="grid gap-2 rounded-xl border border-border p-3"
            >
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_90px_auto]">
                <Input
                  aria-label={t`Script path`}
                  value={script.path}
                  maxLength={200}
                  disabled={readOnly}
                  onChange={(event) =>
                    setScripts((current) =>
                      current.map((candidate, at) =>
                        at === index ? { ...candidate, path: event.target.value } : candidate,
                      ),
                    )
                  }
                />
                <select
                  aria-label={t`Script runtime`}
                  className="h-9 rounded-md border border-input bg-background px-2 text-[12px]"
                  value={script.runtime}
                  disabled={readOnly}
                  onChange={(event) =>
                    setScripts((current) =>
                      current.map((candidate, at) =>
                        at === index
                          ? { ...candidate, runtime: event.target.value as ScriptDraft["runtime"] }
                          : candidate,
                      ),
                    )
                  }
                >
                  <option value="auto">{t`Auto`}</option>
                  <option value="none">{t`Helper`}</option>
                  <option value="node">{t`Node`}</option>
                  <option value="python3">{t`Python`}</option>
                  <option value="sh">{t`Shell`}</option>
                </select>
                <Input
                  aria-label={t`Timeout seconds`}
                  type="number"
                  min={1}
                  max={120}
                  value={script.timeoutSeconds}
                  disabled={readOnly}
                  onChange={(event) =>
                    setScripts((current) =>
                      current.map((candidate, at) =>
                        at === index
                          ? {
                              ...candidate,
                              timeoutSeconds: Math.min(
                                120,
                                Math.max(1, Number(event.target.value) || 1),
                              ),
                            }
                          : candidate,
                      ),
                    )
                  }
                />
                {!readOnly ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t`Remove script`}
                    onClick={() => setScripts((current) => current.filter((_, at) => at !== index))}
                  >
                    <Trash2 size={13} />
                  </Button>
                ) : null}
              </div>
              <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={script.network}
                  disabled={readOnly}
                  onChange={(event) =>
                    setScripts((current) =>
                      current.map((candidate, at) =>
                        at === index ? { ...candidate, network: event.target.checked } : candidate,
                      ),
                    )
                  }
                />
                <Trans>Allow network access</Trans>
              </label>
              <Textarea
                aria-label={t`Script content`}
                value={script.content}
                rows={7}
                maxLength={200_000}
                disabled={readOnly}
                className="font-mono text-[12px]"
                onChange={(event) =>
                  setScripts((current) =>
                    current.map((candidate, at) =>
                      at === index ? { ...candidate, content: event.target.value } : candidate,
                    ),
                  )
                }
              />
            </div>
          ))}
        </div>
        {editing !== "new" ? (
          <p className="text-[11.5px] text-muted-foreground">
            <Trans>Source: {sourceLabel(editing.source)}</Trans>
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
              {editing === "new" ? t`Create` : t`Save`}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              <Trans>Cancel</Trans>
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
                {confirmDelete ? t`Confirm delete` : t`Delete`}
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
          <Trans>New skill</Trans>
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: LocalBridge;
}) {
  const { t } = useLingui();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(820px,calc(100vh-3rem))] overflow-y-auto bg-background shadow-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <Trans>Knowledge and skills</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              Local reference documents and reusable SKILL.md instructions. Organization-managed
              items are read-only.
            </Trans>
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="knowledge">
          <TabsList aria-label={t`Knowledge and skills`}>
            <TabsTrigger value="knowledge">
              <Trans>Knowledge</Trans>
            </TabsTrigger>
            <TabsTrigger value="skills">
              <Trans>Skills</Trans>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="knowledge">
            <KnowledgePanel api={api} open={open} />
          </TabsContent>
          <TabsContent value="skills">
            <SkillsPanel api={api} open={open} />
          </TabsContent>
        </Tabs>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          <Trans>Close</Trans>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
