import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from "lucide-react";
import { memo, type RefObject } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface ThreadSearchBarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  activeMatchIndex: number;
  totalMatches: number;
  onQueryChange: (query: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

export const ThreadSearchBar = memo(function ThreadSearchBar({
  inputRef,
  query,
  activeMatchIndex,
  totalMatches,
  onQueryChange,
  onPrevious,
  onNext,
  onClose,
  onKeyDown,
}: ThreadSearchBarProps) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border/80 bg-card/70 px-2.5 py-2 [-webkit-app-region:no-drag]">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground/70" />
        <Input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Find in thread"
          className="border-0 bg-transparent shadow-none"
        />
      </div>
      <div className="shrink-0 text-xs text-muted-foreground/75">
        {totalMatches === 0 ? "0 results" : `${activeMatchIndex + 1}/${totalMatches}`}
      </div>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7"
        onClick={onPrevious}
        disabled={totalMatches === 0}
        aria-label="Previous match"
      >
        <ChevronUpIcon className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7"
        onClick={onNext}
        disabled={totalMatches === 0}
        aria-label="Next match"
      >
        <ChevronDownIcon className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7"
        onClick={onClose}
        aria-label="Close thread search"
      >
        <XIcon className="size-4" />
      </Button>
    </div>
  );
});
