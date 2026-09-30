export type RoutableBusiness = {
  customerId: string;
  name: string;
  keywords: string[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameMentioned(text: string, name: string): boolean {
  const trimmedName = name.trim();
  if (!trimmedName) return false;
  const escapedName = escapeRegExp(trimmedName);
  if (new RegExp(`(^|\\W)${escapedName}(?=$|\\W)`, "i").test(text)) return true;

  const firstWord = trimmedName.split(/\s+/)[0] ?? "";
  return firstWord.length >= 4 && new RegExp(`\\b${escapeRegExp(firstWord)}\\b`, "i").test(text);
}

function matchesKeyword(text: string, keyword: string): boolean {
  const trimmedKeyword = keyword.trim();
  return trimmedKeyword
    ? new RegExp(`\\b${escapeRegExp(trimmedKeyword)}\\b`, "i").test(text)
    : false;
}

function customerIdsInBusinessOrder(
  businesses: RoutableBusiness[],
  matchingIds: Set<string>,
): string[] {
  return [
    ...new Set(
      businesses
        .filter((business) => matchingIds.has(business.customerId))
        .map((business) => business.customerId),
    ),
  ];
}

export function routeMessage(input: {
  text: string;
  businesses: RoutableBusiness[];
  awaitingCustomerIds: string[];
  random?: () => number;
}): string[] {
  const namedBusinesses = new Set(
    input.businesses
      .filter((business) => nameMentioned(input.text, business.name))
      .map((business) => business.customerId),
  );
  if (namedBusinesses.size > 0) {
    return customerIdsInBusinessOrder(input.businesses, namedBusinesses);
  }

  const matchingKeywords = new Set(
    input.businesses
      .filter((business) =>
        business.keywords.some((keyword) => matchesKeyword(input.text, keyword)),
      )
      .map((business) => business.customerId),
  );
  if (matchingKeywords.size > 0) {
    return customerIdsInBusinessOrder(input.businesses, matchingKeywords);
  }

  const knownCustomerIds = new Set(input.businesses.map((business) => business.customerId));
  const awaitingCustomerId = input.awaitingCustomerIds.find((id) => knownCustomerIds.has(id));
  if (awaitingCustomerId) return [awaitingCustomerId];
  if (input.businesses.length === 0) return [];

  const randomIndex = Math.min(
    input.businesses.length - 1,
    Math.max(0, Math.floor((input.random ?? Math.random)() * input.businesses.length)),
  );
  return [input.businesses[randomIndex]!.customerId];
}
