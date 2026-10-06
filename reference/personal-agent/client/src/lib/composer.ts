export function composeFallbackReply(input: {
  replies: { businessName: string; reply: string }[];
  unreachable: string[];
}): string {
  const [only] = input.replies;
  if (only && input.replies.length === 1 && input.unreachable.length === 0) return only.reply;
  return [
    ...input.replies.map(({ businessName, reply }) => `${businessName}: ${reply}`),
    ...input.unreachable.map((businessName) => `I couldn't reach ${businessName}.`),
  ].join("\n\n");
}
