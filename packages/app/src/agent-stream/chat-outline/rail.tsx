import type { ActivePromptSource, ChatOutlinePrompt, ChatOutlineReplyPreview } from "./model";

export interface ChatOutlineRailProps {
  prompts: ChatOutlinePrompt[];
  contentMaxWidth: number;
  replyPreviews: ReadonlyMap<number, ChatOutlineReplyPreview>;
  activePrompt: ActivePromptSource;
  onJumpToPrompt: (seq: number) => void;
}

// The outline is a wide-layout pointer affordance. Native navigates the transcript by
// scrolling, so there is no rail to render.
export function ChatOutlineRail(_props: ChatOutlineRailProps): null {
  return null;
}
