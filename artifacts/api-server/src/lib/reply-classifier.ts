export type ReplyCategory =
  | "interested"
  | "not_interested"
  | "out_of_office"
  | "referral"
  | "objection"
  | "bounce"
  | "neutral";

export type ReplySentiment = "positive" | "neutral" | "negative";

export interface ReplyClassification {
  category: ReplyCategory;
  sentiment: ReplySentiment;
}

function matches(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function classifyReply(input: {
  fromEmail?: string | null;
  subject?: string | null;
  body?: string | null;
}): ReplyClassification {
  const text = `${input.fromEmail ?? ""}\n${input.subject ?? ""}\n${input.body ?? ""}`.toLowerCase();

  if (matches(text, [
    /mailer-daemon/,
    /postmaster/,
    /delivery status notification/,
    /undeliverable/,
    /delivery failure/,
    /returned mail/,
    /mail delivery subsystem/,
  ])) {
    return { category: "bounce", sentiment: "negative" };
  }

  if (matches(text, [
    /out of office/,
    /automatic reply/,
    /auto-?reply/,
    /thank you for your email/,
    /away from (the )?office/,
    /\bi am away\b/,
    /\bi'?m away\b/,
    /\bi am currently away\b/,
    /\bcurrently away\b/,
    /\bcurrently unavailable\b/,
    /\bunavailable until\b/,
    /\bwill return\b/,
    /\breturn(?:ing)? on\b/,
    /\bback (in|on) (the )?office\b/,
    /\bdo not work (mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b/,
    /\bi work monday to thursday\b/,
    /\blimited access to (my )?email\b/,
    /annual leave/,
    /vacation/,
    /on leave/,
  ])) {
    return { category: "out_of_office", sentiment: "neutral" };
  }

  if (matches(text, [
    /not interested/,
    /no thanks/,
    /no thank you/,
    /unsubscribe/,
    /remove me/,
    /\bstop\b/,
    /do not contact/,
  ])) {
    return { category: "not_interested", sentiment: "negative" };
  }

  if (matches(text, [
    /speak to/,
    /contact [\w\s.-]+@/,
    /reach out to/,
    /try [\w\s]+/,
    /forward(ed|ing)? (this|your|it)/,
    /best person/,
  ])) {
    return { category: "referral", sentiment: "positive" };
  }

  if (matches(text, [
    /budget/,
    /price/,
    /pricing/,
    /too expensive/,
    /not now/,
    /bad timing/,
    /too busy/,
    /later/,
    /next quarter/,
  ])) {
    return { category: "objection", sentiment: "neutral" };
  }

  if (matches(text, [
    /\byes\b/,
    /interested/,
    /sounds good/,
    /send (it|that|over|through)/,
    /book/,
    /meeting/,
    /demo/,
    /call/,
    /let'?s/,
    /looks good/,
  ])) {
    return { category: "interested", sentiment: "positive" };
  }

  return { category: "neutral", sentiment: "neutral" };
}
