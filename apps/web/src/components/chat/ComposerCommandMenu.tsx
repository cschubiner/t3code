import {
  type ProjectEntry,
  type ModelSlug,
  type ProviderKind,
  type SkillSource,
  type Snippet,
} from "@t3tools/contracts";
import { memo } from "react";
import { type ComposerSlashCommand, type ComposerTriggerKind } from "../../composer-logic";
import { BotIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Command, CommandItem, CommandList } from "../ui/command";
import { VscodeEntryIcon } from "./VscodeEntryIcon";

export type ComposerCommandItem =
  | {
      id: string;
      type: "path";
      path: string;
      pathKind: ProjectEntry["kind"];
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "slash-command";
      command: ComposerSlashCommand;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "model";
      provider: ProviderKind;
      model: ModelSlug;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "skill";
      name: string;
      source: SkillSource;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "snippet";
      snippet: Snippet;
      label: string;
      description: string;
    };

export const ComposerCommandMenu = memo(function ComposerCommandMenu(props: {
  items: ComposerCommandItem[];
  resolvedTheme: "light" | "dark";
  isLoading: boolean;
  triggerKind: ComposerTriggerKind | null;
  activeItemId: string | null;
  onHighlightedItemChange: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  return (
    <Command
      mode="none"
      onItemHighlighted={(highlightedValue) => {
        props.onHighlightedItemChange(
          typeof highlightedValue === "string" ? highlightedValue : null,
        );
      }}
    >
      <div className="relative overflow-hidden rounded-xl border border-border/80 bg-popover/96 shadow-lg/8 backdrop-blur-xs">
        <CommandList className="max-h-64">
          {props.items.map((item) => (
            <ComposerCommandMenuItem
              key={item.id}
              item={item}
              resolvedTheme={props.resolvedTheme}
              isActive={props.activeItemId === item.id}
              onSelect={props.onSelect}
            />
          ))}
        </CommandList>
        {props.items.length === 0 && (
          <p className="px-3 py-2 text-muted-foreground/70 text-xs">
            {props.isLoading
              ? props.triggerKind === "skill"
                ? "Searching skills..."
                : props.triggerKind === "snippet"
                  ? "Loading snippets..."
                  : "Searching workspace files..."
              : props.triggerKind === "path"
                ? "No matching files or folders."
                : props.triggerKind === "skill"
                  ? "No matching skills."
                  : props.triggerKind === "snippet"
                    ? "No matching snippets."
                    : "No matching command."}
          </p>
        )}
      </div>
    </Command>
  );
});

function SkillSourceBadge(props: { source: SkillSource }) {
  if (props.source === "workspace") {
    return (
      <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
        local
      </Badge>
    );
  }

  if (props.source === "extra-root") {
    return (
      <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
        custom
      </Badge>
    );
  }

  return null;
}

const ComposerCommandMenuItem = memo(function ComposerCommandMenuItem(props: {
  item: ComposerCommandItem;
  resolvedTheme: "light" | "dark";
  isActive: boolean;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  return (
    <CommandItem
      value={props.item.id}
      className={cn(
        "cursor-pointer select-none items-start gap-2",
        props.isActive && "bg-accent text-accent-foreground",
      )}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onSelect(props.item);
      }}
    >
      {props.item.type === "path" ? (
        <VscodeEntryIcon
          pathValue={props.item.path}
          kind={props.item.pathKind}
          theme={props.resolvedTheme}
        />
      ) : null}
      {props.item.type === "slash-command" ? (
        <BotIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground/80" />
      ) : null}
      {props.item.type === "model" ? (
        <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
          model
        </Badge>
      ) : null}
      {props.item.type === "snippet" ? (
        <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
          snippet
        </Badge>
      ) : null}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm leading-tight",
            props.item.type === "skill" ? "break-all whitespace-normal" : "truncate",
          )}
        >
          {props.item.label}
        </p>
        {props.item.type === "skill" ? (
          <>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
                skill
              </Badge>
              <SkillSourceBadge source={props.item.source} />
            </div>
            {props.item.description ? (
              <p className="mt-1 truncate text-muted-foreground/70 text-xs leading-tight">
                {props.item.description}
              </p>
            ) : null}
          </>
        ) : props.item.description ? (
          <p className="truncate text-muted-foreground/70 text-xs leading-tight">
            {props.item.description}
          </p>
        ) : null}
      </div>
    </CommandItem>
  );
});
