import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { appointments, aops, customerUsers } from "../db/schema.js";

export type FlowState = {
  aopId?: string;
  verificationEmail?: string;
  verificationDob?: string;
  verificationFailures?: number;
  verifiedUserId?: string;
  awaitingRescheduleTime?: boolean;
  escalated?: boolean;
};

export interface AgentTurn {
  state: string;
  text: string;
  aopId: string | null;
  verifiedCustomerUserId: string | null;
  flow: FlowState;
}

const INPUT_REQUIRED = "TASK_STATE_INPUT_REQUIRED";
const COMPLETED = "TASK_STATE_COMPLETED";

function escalation(name: string, flow: FlowState, aopId: string | null): AgentTurn {
  const text = `A human will follow up via ${name}'s normal support channel.`;
  return {
    state: INPUT_REQUIRED,
    text,
    aopId,
    verifiedCustomerUserId: flow.verifiedUserId ?? null,
    flow: { ...flow, escalated: true },
  };
}

function extractVerification(text: string): { email?: string; dob?: string } {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase();
  const dob = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  return { ...(email ? { email } : {}), ...(dob ? { dob } : {}) };
}

export async function runAgentTurn(input: {
  db: Db;
  customerId: string;
  customerName: string;
  initialText: string;
  previousAopId: string | null;
  previousVerifiedUserId: string | null;
  previousFlow: FlowState;
  now?: () => Date;
}): Promise<AgentTurn> {
  const { db, customerId, customerName } = input;
  const text = input.initialText.trim();
  const lower = text.toLowerCase();
  const flow: FlowState = { ...input.previousFlow };
  if (input.previousAopId) flow.aopId = input.previousAopId;
  if (input.previousVerifiedUserId) flow.verifiedUserId = input.previousVerifiedUserId;
  if (flow.escalated) return escalation(customerName, flow, flow.aopId ?? null);

  const visibleAops = await db
    .select()
    .from(aops)
    .where(and(eq(aops.customerId, customerId), sql`${aops.channels} @> ARRAY['a2a']::text[]`));

  if (!flow.aopId) {
    if (/\b(dispute|refund|charge|bill|billing)\b/.test(lower)) {
      const billing = visibleAops.find((item) => item.id === "billing_dispute");
      return escalation(
        customerName,
        billing ? { ...flow, aopId: billing.id } : flow,
        "billing_dispute",
      );
    }
    const route =
      (/\b(reschedule|move|change)\b/.test(lower) && /\b(appointment|appt)\b/.test(lower)
        ? "appointment_reschedule"
        : undefined) ??
      (/\b(appointment|appt|booking)\b/.test(lower) ? "appointment_lookup" : undefined) ??
      (/\b(hours|open|location|address|parking|insurance|faq)\b/.test(lower) ? "faq" : undefined);
    if (/\b(human|agent|representative|person)\b/.test(lower)) {
      return escalation(customerName, flow, null);
    }
    if (route) {
      const aop = visibleAops.find((item) => item.id === route);
      if (!aop) return escalation(customerName, { ...flow, aopId: route }, route);
      flow.aopId = aop.id;
    } else {
      return {
        state: INPUT_REQUIRED,
        text: `I can help with ${visibleAops.map((item) => item.name.toLowerCase()).join(", ")}. What would you like to do?`,
        aopId: null,
        verifiedCustomerUserId: null,
        flow,
      };
    }
  }

  const aop = visibleAops.find((item) => item.id === flow.aopId);
  if (!aop) return escalation(customerName, flow, flow.aopId ?? null);

  if (aop.id === "faq") {
    const answer = /\bhours?\b|\bopen\b/.test(lower)
      ? `${customerName} is open Monday through Friday, 8:00 AM to 5:00 PM.`
      : /\blocation\b|\baddress\b/.test(lower)
        ? `${customerName} is at 100 Main Street, San Francisco, CA.`
        : /\bparking\b/.test(lower)
          ? "Validated patient parking is available in the garage next to the clinic."
          : /\binsurance\b/.test(lower)
            ? `${customerName} accepts most major insurance plans. Please contact your insurer to confirm coverage.`
            : "I can help with hours, location, parking, or insurance questions.";
    return {
      state: /\bhours?\b|\bopen\b|\blocation\b|\baddress\b|\bparking\b|\binsurance\b/.test(lower)
        ? COMPLETED
        : INPUT_REQUIRED,
      text: answer,
      aopId: aop.id,
      verifiedCustomerUserId: flow.verifiedUserId ?? null,
      flow,
    };
  }

  if (aop.requiresVerification && !flow.verifiedUserId) {
    const supplied = extractVerification(text);
    if (supplied.email && !flow.verificationEmail) flow.verificationEmail = supplied.email;
    if (supplied.dob && !flow.verificationDob) flow.verificationDob = supplied.dob;
    if (!flow.verificationEmail || !flow.verificationDob) {
      const missing = [
        ...(flow.verificationEmail ? [] : ["email address"]),
        ...(flow.verificationDob ? [] : ["date of birth (YYYY-MM-DD)"]),
      ];
      return {
        state: INPUT_REQUIRED,
        text: `Please provide your ${missing.join(" and ")} so I can verify your identity.`,
        aopId: aop.id,
        verifiedCustomerUserId: null,
        flow,
      };
    }
    const [user] = await db
      .select()
      .from(customerUsers)
      .where(
        and(
          eq(customerUsers.customerId, customerId),
          eq(customerUsers.email, flow.verificationEmail),
          eq(customerUsers.dateOfBirth, flow.verificationDob),
        ),
      )
      .limit(1);
    if (!user) {
      flow.verificationFailures = (flow.verificationFailures ?? 0) + 1;
      delete flow.verificationEmail;
      delete flow.verificationDob;
      if (flow.verificationFailures >= 3) return escalation(customerName, flow, aop.id);
      return {
        state: INPUT_REQUIRED,
        text: "I couldn't verify your information. Please try again with your email address and date of birth (YYYY-MM-DD).",
        aopId: aop.id,
        verifiedCustomerUserId: null,
        flow,
      };
    }
    flow.verifiedUserId = user.id;
  }

  const userId = flow.verifiedUserId ?? input.previousVerifiedUserId;
  if (!userId) {
    return {
      state: INPUT_REQUIRED,
      text: "Please provide your email address and date of birth (YYYY-MM-DD).",
      aopId: aop.id,
      verifiedCustomerUserId: null,
      flow,
    };
  }
  const now = input.now?.() ?? new Date();
  const [nextAppointment] = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.customerId, customerId),
        eq(appointments.customerUserId, userId),
        gt(appointments.startsAt, now),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .limit(1);

  if (aop.id === "appointment_lookup") {
    const answer = nextAppointment
      ? `Your next appointment is ${nextAppointment.startsAt.toISOString()} with ${nextAppointment.providerName}.`
      : "You have no upcoming appointments.";
    return { state: COMPLETED, text: answer, aopId: aop.id, verifiedCustomerUserId: userId, flow };
  }
  if (aop.id === "appointment_reschedule") {
    if (!nextAppointment) {
      return {
        state: COMPLETED,
        text: "You have no upcoming appointments to reschedule.",
        aopId: aop.id,
        verifiedCustomerUserId: userId,
        flow,
      };
    }
    const requested = text.match(/\b\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\b/)?.[0];
    const requestedDate = requested ? new Date(`${requested.replace(" ", "T")}:00Z`) : undefined;
    const normalizedRequested = requested?.replace(" ", "T");
    if (
      !requestedDate ||
      Number.isNaN(requestedDate.getTime()) ||
      requestedDate.toISOString().slice(0, 16) !== normalizedRequested ||
      requestedDate <= now
    ) {
      flow.awaitingRescheduleTime = true;
      return {
        state: INPUT_REQUIRED,
        text: `Your next appointment is ${nextAppointment.startsAt.toISOString()}. What new time would you like? Use YYYY-MM-DD HH:MM (UTC).`,
        aopId: aop.id,
        verifiedCustomerUserId: userId,
        flow,
      };
    }
    await db
      .update(appointments)
      .set({ startsAt: requestedDate })
      .where(eq(appointments.id, nextAppointment.id));
    flow.awaitingRescheduleTime = false;
    return {
      state: COMPLETED,
      text: `Your appointment has been rescheduled to ${requestedDate.toISOString()}.`,
      aopId: aop.id,
      verifiedCustomerUserId: userId,
      flow,
    };
  }
  return {
    state: INPUT_REQUIRED,
    text: "Please tell me how I can help.",
    aopId: aop.id,
    verifiedCustomerUserId: userId,
    flow,
  };
}
