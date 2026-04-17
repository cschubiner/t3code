/**
 * SkillPickerDialog
 *
 * Filesystem-discovered skills (`.codex/skills`, `.claude/skills`) for the
 * current project's cwd, with arrow-key search + insert into composer.
 *
 * The picker inserts a reference block that points the agent at the skill's
 * SKILL.md on disk. The agent reads the file with its Read tool when it
 * needs the full instructions — keeps the composer prompt small and lets
 * the agent decide whether to load the body.
 */
import type { SkillSummary } from "@t3tools/contracts";
import { useDeferredValue, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { ensureLocalApi } from "../localApi";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { useQuery } from "@tanstack/react-query";

interface SkillPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cwd: string | null;
  focusRequestId: number;
  onSelectSkill: (skill: SkillSummary) => void;
}

export function formatSkillReferenceBlock(skill: SkillSummary): string {
  const description = skill.description ? `\n${skill.description.trim()}` : "";
  return [
    `## Use skill: ${skill.name}${description}`,
    ``,
    `Read the full instructions from: ${skill.skillPath}`,
  ].join("\n");
}

export function SkillPickerDialog({
  open,
  onOpenChange,
  cwd,
  focusRequestId,
  onSelectSkill,
}: SkillPickerDialogProps) {
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlightedIndex(0);
      return;
    }
    setQuery("");
    setHighlightedIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [focusRequestId, open]);

  const skillsQuery = useQuery({
    queryKey: ["skills", "search", cwd, deferredQuery],
    enabled: open && cwd !== null,
    queryFn: async () => {
      if (!cwd) return { skills: [], truncated: false };
      const api = ensureLocalApi();
      const trimmed = deferredQuery.trim();
      return api.skills.search({
        cwd,
        // Contract requires non-empty query, but the server's
        // `normalizeSearchQuery` strips a leading "$", so passing "$"
        // gets normalized to "" which the scorer treats as match-all.
        query: trimmed.length > 0 ? trimmed : "$",
        limit: 50,
      });
    },
    staleTime: 15_000,
  });

  const skills = skillsQuery.data?.skills ?? [];

  // Server already filters/sorts by query; just surface the results.
  const filtered = skills;

  useEffect(() => {
    if (filtered.length === 0) {
      setHighlightedIndex(0);
      return;
    }
    setHighlightedIndex((current) => Math.min(current, filtered.length - 1));
  }, [filtered.length]);

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filtered.length === 0) return;
      setHighlightedIndex((current) => (current + 1) % filtered.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filtered.length === 0) return;
      setHighlightedIndex((current) => (current - 1 + filtered.length) % filtered.length);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const skill = filtered[highlightedIndex];
    if (!skill) return;
    onSelectSkill(skill);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-3xl" bottomStickOnMobile={false}>
        <DialogHeader>
          <DialogTitle>Skills</DialogTitle>
          <DialogDescription>
            Search project skills (`.codex/skills`, `.claude/skills`) and press Enter to reference
            one in the composer. The agent reads the skill body from disk when it needs it.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="space-y-2">
            <Input
              ref={inputRef}
              type="search"
              placeholder={cwd ? "Search skills" : "No active project"}
              data-testid="skill-picker-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              disabled={!cwd}
            />
            <div className="flex items-center justify-between gap-3 text-muted-foreground text-xs">
              <span>
                {!cwd
                  ? "Open or create a thread to search project skills."
                  : skillsQuery.isLoading
                    ? "Loading…"
                    : skillsQuery.isError
                      ? `Error: ${(skillsQuery.error as Error).message}`
                      : skills.length === 0
                        ? "No skills found in this project's `.codex/skills` or `.claude/skills`."
                        : filtered.length === 0
                          ? "No skills matched this search."
                          : `${filtered.length} skill${filtered.length === 1 ? "" : "s"}${
                              skillsQuery.data?.truncated ? " (truncated)" : ""
                            }`}
              </span>
              <span>Enter inserts • Up/Down moves • Esc closes</span>
            </div>
          </div>

          <div className="min-h-[24rem] overflow-hidden rounded-xl border">
            <ScrollArea>
              <div className="divide-y">
                {filtered.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">
                    {!cwd
                      ? "Open a thread on a project to discover its skills."
                      : skills.length === 0
                        ? "No skills found."
                        : "No skills matched this search."}
                  </div>
                ) : (
                  filtered.map((skill, index) => {
                    const isActive = index === highlightedIndex;
                    return (
                      <button
                        type="button"
                        key={`${skill.skillPath}`}
                        className={
                          "flex w-full flex-col items-stretch gap-1 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40 focus:bg-muted/60 focus:outline-none" +
                          (isActive ? " bg-muted/60" : "")
                        }
                        onMouseEnter={() => setHighlightedIndex(index)}
                        onClick={() => onSelectSkill(skill)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-foreground">{skill.name}</span>
                          <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
                            {skill.source}
                          </Badge>
                        </div>
                        {skill.description ? (
                          <span className="line-clamp-2 text-xs text-muted-foreground">
                            {skill.description}
                          </span>
                        ) : null}
                        <span
                          className="truncate text-[10px] text-muted-foreground/70"
                          title={skill.skillPath}
                        >
                          {skill.skillPath}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
