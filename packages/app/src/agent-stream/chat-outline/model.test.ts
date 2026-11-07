import type { StreamItem } from "@/types/stream";
import { describe, expect, it } from "vitest";
import {
  buildChatOutlineReplyPreviews,
  resolveChatOutlineLayout,
  createActivePromptPublisher,
  shouldAcceptPromptIndexEpoch,
  promptTickMagnification,
  resolveActivePromptSeq,
  OUTLINE_MAGNIFY_RADIUS,
  type ChatOutlinePrompt,
} from "./model";

describe("chat outline prompt index epoch", () => {
  it("accepts only the authoritative timeline epoch", () => {
    expect(shouldAcceptPromptIndexEpoch("epoch-2", "epoch-2")).toBe(true);
    expect(shouldAcceptPromptIndexEpoch("epoch-2", "epoch-1")).toBe(false);
  });
});

function prompt(seq: number): ChatOutlinePrompt {
  return { seq, timestamp: new Date(seq).toISOString(), preview: `prompt ${seq}` };
}

describe("promptTickMagnification", () => {
  it("peaks under the pointer and decays to nothing at the radius", () => {
    expect(promptTickMagnification(0)).toBe(1);
    expect(promptTickMagnification(OUTLINE_MAGNIFY_RADIUS)).toBe(0);
    expect(promptTickMagnification(OUTLINE_MAGNIFY_RADIUS + 10)).toBe(0);
  });

  it("falls off monotonically and symmetrically around the pointer", () => {
    const above = [0, 1, 2, 3].map((distance) => promptTickMagnification(distance));
    const below = [0, -1, -2, -3].map((distance) => promptTickMagnification(distance));

    expect(above).toEqual(below);
    expect(above).toEqual([...above].sort((left, right) => right - left));
  });
});

describe("resolveActivePromptSeq", () => {
  const prompts = [prompt(2), prompt(9), prompt(20)];

  it("marks the prompt whose turn the reading position sits in", () => {
    expect(resolveActivePromptSeq(prompts, 9)).toBe(9);
    expect(resolveActivePromptSeq(prompts, 14)).toBe(9);
    expect(resolveActivePromptSeq(prompts, 20)).toBe(20);
    expect(resolveActivePromptSeq(prompts, 99)).toBe(20);
  });

  it("marks nothing above the first prompt or without a reading position", () => {
    expect(resolveActivePromptSeq(prompts, 1)).toBeNull();
    expect(resolveActivePromptSeq(prompts, null)).toBeNull();
    expect(resolveActivePromptSeq([], 42)).toBeNull();
  });
});

describe("createActivePromptPublisher", () => {
  it("notifies subscribers only when the active prompt changes", () => {
    const publisher = createActivePromptPublisher();
    let notifications = 0;
    const unsubscribe = publisher.subscribe(() => {
      notifications += 1;
    });

    publisher.publish(9);
    publisher.publish(9);
    publisher.publish(20);
    unsubscribe();
    publisher.publish(null);

    expect(notifications).toBe(2);
    expect(publisher.getActiveSeq()).toBeNull();
  });
});

describe("loaded reply previews", () => {
  const prompts = [prompt(2), prompt(10), prompt(20)];
  function answer(seq: number, text: string, epoch = "current"): StreamItem {
    return {
      kind: "assistant_message",
      id: `answer-${seq}`,
      text,
      timestamp: new Date(seq),
      timelineCursor: { epoch, seq },
    };
  }

  it("associates the latest loaded assistant message with its indexed turn", () => {
    const replies = buildChatOutlineReplyPreviews({
      prompts,
      epoch: "current",
      items: [
        answer(1, "Before the first prompt"),
        answer(3, "Progress update"),
        answer(8, "Final answer"),
        answer(11, "Second turn"),
      ],
    });
    expect([...replies]).toEqual([
      [2, { seq: 8, text: "Final answer" }],
      [10, { seq: 11, text: "Second turn" }],
    ]);
    expect(replies.has(20)).toBe(false);
  });

  it("does not interpret unloaded turns or another epoch as empty answers", () => {
    const replies = buildChatOutlineReplyPreviews({
      prompts,
      epoch: "current",
      items: [answer(4, "Stale answer", "old")],
    });
    expect(replies.size).toBe(0);
  });

  it("updates a streamed reply without rescanning history or overwriting a newer loaded answer", () => {
    const history = buildChatOutlineReplyPreviews({
      prompts,
      epoch: "current",
      items: [answer(8, "History"), answer(11, "Partial")],
    });
    const replies = buildChatOutlineReplyPreviews({
      prompts,
      epoch: "current",
      previous: history,
      items: [answer(4, "Older"), answer(11, "Complete answer")],
    });
    expect(replies.get(2)?.text).toBe("History");
    expect(replies.get(10)?.text).toBe("Complete answer");
    expect(history.get(10)?.text).toBe("Partial");
  });

  it("uses the full prompt index beyond a hundred entries, including unloaded prompts", () => {
    const index = Array.from({ length: 101 }, (_, i) => prompt(i * 10));
    const replies = buildChatOutlineReplyPreviews({
      prompts: index,
      epoch: "current",
      items: [answer(1001, "Last indexed turn")],
    });
    expect([...replies.keys()]).toEqual([1000]);
    expect(replies.has(0)).toBe(false);
  });

  it("bounds preview text and excludes tools, thoughts, and optimistic messages", () => {
    const optimistic: StreamItem = {
      kind: "assistant_message",
      id: "optimistic",
      timestamp: new Date(),
      text: "Unattributed",
    };
    const thought: StreamItem = {
      kind: "thought",
      id: "thought",
      timestamp: new Date(),
      text: "Private reasoning",
      status: "ready",
      timelineCursor: { epoch: "current", seq: 12 },
    };
    const replies = buildChatOutlineReplyPreviews({
      prompts,
      epoch: "current",
      items: [answer(3, "x".repeat(10000)), answer(4, "  "), optimistic, thought],
    });
    expect(replies.get(2)?.text).toBe(`${"x".repeat(360)}…`);
    expect(replies.has(10)).toBe(false);
  });
});

describe("adaptive outline gutter", () => {
  it("uses a narrow hover strip instead of hiding a split panel", () => {
    expect(resolveChatOutlineLayout(560, 820)).toEqual({
      hitWidth: 8,
      persistent: false,
      previewWidth: 300,
    });
  });
  it("uses the configured content width rather than a fixed panel breakpoint", () => {
    expect(resolveChatOutlineLayout(800, 600).persistent).toBe(true);
    expect(resolveChatOutlineLayout(1000, 1200).persistent).toBe(false);
  });
  it("keeps previews within small panels and waits for a real layout", () => {
    expect(resolveChatOutlineLayout(240, 820).previewWidth).toBe(216);
    expect(resolveChatOutlineLayout(0, 820).hitWidth).toBe(0);
  });
});
