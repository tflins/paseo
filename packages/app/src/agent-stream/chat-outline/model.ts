import type { StreamItem } from "@/types/stream";
import type { AgentTimelinePromptIndexPayload } from "@getpaseo/client/internal/daemon-client";

export type ChatOutlinePrompt = AgentTimelinePromptIndexPayload["prompts"][number];

export function shouldAcceptPromptIndexEpoch(timelineEpoch: string, indexEpoch: string): boolean {
  return timelineEpoch === indexEpoch;
}

/**
 * Slots further than this from the pointer keep their resting size, so a long rail
 * magnifies a local band instead of swelling the whole column.
 */
export const OUTLINE_MAGNIFY_RADIUS = 3;

/**
 * Dock-style falloff: 1 under the pointer, easing to 0 at the radius. The raised cosine
 * has no corner at either end, so sweeping the rail reads as one bulge travelling with
 * the pointer rather than a band switching on and off.
 */
export function promptTickMagnification(slotDistance: number): number {
  const distance = Math.abs(slotDistance);
  if (!Number.isFinite(distance) || distance >= OUTLINE_MAGNIFY_RADIUS) {
    return 0;
  }
  return (1 + Math.cos((Math.PI * distance) / OUTLINE_MAGNIFY_RADIUS)) / 2;
}

/**
 * The prompt whose turn the reader is inside: the last indexed prompt at or before the
 * timeline position under the top of the viewport. It reads the complete daemon index,
 * so a prompt outside the loaded window still lights up while its turn is on screen.
 */
export function resolveActivePromptSeq(
  prompts: readonly ChatOutlinePrompt[],
  anchorSeq: number | null,
): number | null {
  if (anchorSeq === null) {
    return null;
  }
  let low = 0;
  let high = prompts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (prompts[middle]!.seq <= anchorSeq) low = middle + 1;
    else high = middle;
  }
  return prompts[low - 1]?.seq ?? null;
}

export interface ActivePromptSource {
  subscribe: (listener: () => void) => () => void;
  getActiveSeq: () => number | null;
}

export interface ActivePromptPublisher extends ActivePromptSource {
  publish: (seq: number | null) => void;
}

/**
 * The transcript reports its reading position on every scroll frame, far more often than
 * it re-renders. Keeping the active prompt outside React lets the rail subscribe to it
 * without dragging the transcript through a render on each frame.
 */
export function createActivePromptPublisher(): ActivePromptPublisher {
  const listeners = new Set<() => void>();
  let activeSeq: number | null = null;
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getActiveSeq: () => activeSeq,
    publish(seq) {
      if (seq === activeSeq) {
        return;
      }
      activeSeq = seq;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

export interface ChatOutlineReplyPreview {
  seq: number;
  text: string;
}

/** Only loaded assistant text is eligible; an index entry does not imply a loaded answer. */
export function buildChatOutlineReplyPreviews(input: {
  prompts: readonly ChatOutlinePrompt[];
  items: readonly StreamItem[];
  epoch: string | null;
  previous?: ReadonlyMap<number, ChatOutlineReplyPreview>;
}): ReadonlyMap<number, ChatOutlineReplyPreview> {
  const replies = new Map(input.previous);
  for (const item of input.items) {
    if (item.kind !== "assistant_message" || !item.timelineCursor) continue;
    const { epoch, seq } = item.timelineCursor;
    if (epoch !== input.epoch) continue;
    const promptSeq = resolveActivePromptSeq(input.prompts, seq);
    if (promptSeq === null) continue;
    const previous = replies.get(promptSeq);
    if (previous && previous.seq > seq) continue;
    const text = item.text.slice(0, 2048).replace(/\s+/gu, " ").trim();
    if (!text) continue;
    replies.set(promptSeq, { seq, text: text.length > 360 ? `${text.slice(0, 360)}…` : text });
  }
  return replies;
}

/** Reserve only the transcript's side gutter; narrow panels reveal the rail on intent. */
export function resolveChatOutlineLayout(panelWidth: number, contentMaxWidth: number) {
  if (
    !Number.isFinite(panelWidth) ||
    panelWidth <= 0 ||
    !Number.isFinite(contentMaxWidth) ||
    contentMaxWidth <= 0
  ) {
    return { hitWidth: 0, persistent: false, previewWidth: 0 };
  }
  // The transcript always reserves at least 12 px of outer horizontal padding.
  const gutter = Math.max(12, (panelWidth - contentMaxWidth) / 2);
  const hitWidth = Math.min(36, Math.max(0, Math.floor(gutter) - 4));
  return {
    hitWidth,
    persistent: gutter >= 44,
    previewWidth: Math.min(300, Math.max(0, panelWidth - hitWidth - 16)),
  };
}
