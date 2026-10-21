import {
  BotAvatar,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@rakazo/ui-web";
import { LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { type LocalBot, type LocalBridge, type LocalGroup, localErrorMessage } from "./types";

export function LocalGroupDialog({
  open,
  onOpenChange,
  api,
  bots,
  group,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: LocalBridge;
  bots: readonly LocalBot[];
  group?: LocalGroup;
  onSaved: (group: LocalGroup) => void;
  onDeleted?: (groupId: string) => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [selected, setSelected] = useState<string[]>(
    group?.members.map((member) => member.id) ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? "");
    setDescription(group?.description ?? "");
    setSelected(group?.members.map((member) => member.id) ?? []);
    setConfirmDelete(false);
    setError("");
  }, [group, open]);

  const valid = name.trim().length > 0 && selected.length >= 2 && selected.length <= 10;

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = group
        ? await api.groups.update(group.id, {
            name: name.trim(),
            description: description.trim(),
            botIds: selected,
          })
        : await api.groups.create({
            name: name.trim(),
            description: description.trim(),
            botIds: selected,
            color: "violet",
          });
      onSaved(saved);
      onOpenChange(false);
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!group || saving) return;
    setSaving(true);
    setError("");
    try {
      await api.groups.remove(group.id);
      onDeleted?.(group.id);
      onOpenChange(false);
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(680px,calc(100vh-3rem))] bg-background shadow-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{group ? "Group settings" : "New group"}</DialogTitle>
          <DialogDescription>
            Pick 2–10 bots. Every member shares this group&apos;s history and can hand work to
            another member.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <label
            htmlFor="local-group-name"
            className="grid gap-1.5 text-[12px] text-muted-foreground"
          >
            Name
            <Input
              id="local-group-name"
              value={name}
              maxLength={120}
              placeholder="Research team"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label
            htmlFor="local-group-description"
            className="grid gap-1.5 text-[12px] text-muted-foreground"
          >
            Description
            <Input
              id="local-group-description"
              value={description}
              maxLength={2_000}
              placeholder="What this group works on"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>

        <div className="min-h-0 overflow-hidden rounded-xl border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[12px] text-muted-foreground">
            <span>Members</span>
            <span>{selected.length}/10</span>
          </div>
          <div className="rk-scroll max-h-64 overflow-y-auto p-1.5">
            {bots.map((bot) => {
              const checked = selected.includes(bot.id);
              return (
                <div
                  key={bot.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-accent"
                >
                  <BotAvatar color={bot.color} identity={bot.id} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{bot.name}</span>
                    <span className="block truncate text-[10.5px] text-muted-foreground">
                      {bot.description || "Local bot"}
                    </span>
                  </span>
                  <Checkbox
                    checked={checked}
                    aria-label={`${checked ? "Remove" : "Add"} ${bot.name}`}
                    onCheckedChange={() =>
                      setSelected((current) =>
                        checked
                          ? current.filter((id) => id !== bot.id)
                          : current.length < 10
                            ? [...current, bot.id]
                            : current,
                      )
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-[12.5px] text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter className="justify-between">
          <div>
            {group ? (
              confirmDelete ? (
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={saving}
                    onClick={() => void remove()}
                  >
                    Confirm delete
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={13} />
                  Delete
                </Button>
              )
            ) : null}
          </div>
          <div className="flex gap-1.5">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={!valid || saving} onClick={() => void save()}>
              {saving ? <LoaderCircle size={13} className="animate-spin" /> : null}
              {group ? "Save" : "Create"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
