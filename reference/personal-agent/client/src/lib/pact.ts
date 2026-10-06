import { fetchAgentCard, interfaceUrl, type AgentCard } from "@openpactprotocol/client";

export function agentCardUrl(providerUrl: string, customerId: string): string {
  return `${providerUrl.replace(/\/+$/, "")}/a2a/${encodeURIComponent(customerId)}/.well-known/agent-card.json`;
}

export async function discoverAgent(
  providerUrl: string,
  customerId: string,
): Promise<{ card: AgentCard; url: string }> {
  const card = await fetchAgentCard(agentCardUrl(providerUrl, customerId));
  return { card, url: interfaceUrl(card) };
}
