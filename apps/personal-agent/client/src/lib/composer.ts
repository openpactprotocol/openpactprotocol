export function composeFallbackReply(input: {
  replies: { businessName: string; reply: string }[];
  unreachable: string[];
}): string {
  return [
    ...input.replies.map(({ businessName, reply }) => `${businessName}: ${reply}`),
    ...input.unreachable.map((businessName) => `I couldn't reach ${businessName}.`),
  ].join("\n\n");
}
