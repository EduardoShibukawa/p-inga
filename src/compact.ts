export interface ContextMessage {
  role: string;
  content?: string;
  tool_calls?: any[];
  tool_call_id?: string;
  [key: string]: any;
}

export interface CompactOptions {
  maxChars?: number;           // Default: 40000
  keepRecentMessages?: number; // Default: 6
  maxObservationChars?: number;// Default: 300
}

function getTotalChars(messages: ContextMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === "string") {
      total += m.content.length;
    }
  }
  return total;
}

export function compactContext(
  messages: ContextMessage[],
  opts?: CompactOptions
): { messages: ContextMessage[]; compacted: boolean; charsSaved: number } {
  const maxChars = opts?.maxChars ?? 40000;
  const keepRecentMessages = opts?.keepRecentMessages ?? 6;
  const maxObservationChars = opts?.maxObservationChars ?? 300;

  const originalTotal = getTotalChars(messages);
  if (originalTotal <= maxChars) {
    return {
      messages: [...messages],
      compacted: false,
      charsSaved: 0,
    };
  }

  const recentStartIdx = Math.max(0, messages.length - keepRecentMessages);
  const firstUserIdx = messages.findIndex((m) => m.role === "user");

  const compactedMessages: ContextMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    const isSystem = msg.role === "system";
    const isFirstUser = i === firstUserIdx;
    const isRecent = i >= recentStartIdx;

    if (
      !isSystem &&
      !isFirstUser &&
      !isRecent &&
      msg.role === "tool" &&
      typeof msg.content === "string" &&
      msg.content.length > maxObservationChars
    ) {
      const trimmed = msg.content.length - maxObservationChars;
      const prefix = msg.content.slice(0, maxObservationChars);
      const annotation = `\n... [p-inga: trimmed ${trimmed} chars of older observation to protect context window]`;
      compactedMessages.push({
        ...msg,
        content: prefix + annotation,
      });
    } else {
      compactedMessages.push({ ...msg });
    }
  }

  const newTotal = getTotalChars(compactedMessages);
  const charsSaved = originalTotal - newTotal;

  return {
    messages: compactedMessages,
    compacted: true,
    charsSaved,
  };
}
