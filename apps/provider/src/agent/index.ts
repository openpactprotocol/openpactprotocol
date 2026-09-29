export type FlowState = {
  awaitingFaqTopic?: boolean;
  escalated?: boolean;
};

export type AgentTurn = {
  state: "TASK_STATE_COMPLETED" | "TASK_STATE_INPUT_REQUIRED";
  text: string;
  flow: FlowState;
};

const INPUT_REQUIRED = "TASK_STATE_INPUT_REQUIRED";
const COMPLETED = "TASK_STATE_COMPLETED";
const FAQ_PROMPT = "Which would you like to know about: hours, location, parking, or insurance?";

function escalation(customerName: string, flow: FlowState): AgentTurn {
  return {
    state: INPUT_REQUIRED,
    text: `A human will follow up via ${customerName}'s normal support channel.`,
    flow: { ...flow, awaitingFaqTopic: false, escalated: true },
  };
}

function faqAnswer(customerName: string, text: string): string | undefined {
  const lower = text.toLowerCase();
  if (/\bhours?\b|\bopen\b/.test(lower))
    return `${customerName} is open Monday through Friday, 8:00 AM to 5:00 PM.`;
  if (/\blocation\b|\baddress\b/.test(lower))
    return `${customerName} is at 100 Main Street, San Francisco, CA.`;
  if (/\bparking\b/.test(lower))
    return "Validated patient parking is available in the garage next to the clinic.";
  if (/\binsurance\b/.test(lower))
    return `${customerName} accepts most major insurance plans. Please contact your insurer to confirm coverage.`;
  return undefined;
}

export async function runAgentTurn(input: {
  customerName: string;
  initialText: string;
  previousFlow: FlowState;
}): Promise<AgentTurn> {
  const flow = { ...input.previousFlow };
  if (flow.escalated || /\b(human|agent|representative|person)\b/i.test(input.initialText)) {
    return escalation(input.customerName, flow);
  }

  const answer = faqAnswer(input.customerName, input.initialText);
  if (answer) {
    return {
      state: COMPLETED,
      text: answer,
      flow: { ...flow, awaitingFaqTopic: false, escalated: false },
    };
  }

  return {
    state: INPUT_REQUIRED,
    text: FAQ_PROMPT,
    flow: { ...flow, awaitingFaqTopic: true },
  };
}
