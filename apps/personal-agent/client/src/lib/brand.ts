const BRAND_COLORS = ["#16345c", "#1f4d3a", "#7a1f45", "#7a4a0c", "#3b3b8f"];

export function brandColor(customerIds: string[], customerId: string): string {
  const index = Math.max(0, customerIds.indexOf(customerId));
  return BRAND_COLORS[index % BRAND_COLORS.length] ?? "#16345c";
}
