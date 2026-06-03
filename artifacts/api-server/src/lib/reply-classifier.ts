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
    /email (address )?(is )?no longer in use/,
    /mailbox (is )?no longer in use/,
    /address (is )?no longer in use/,
    /this email (address )?(is )?no longer monitored/,
    /mailbox (is )?not monitored/,
    /email (account|address) (has been )?(closed|disabled|deactivated)/,
    /recipient no longer (works|employed|available)/,
    /no longer with (the )?(business|company|organisation|organization)/,
    /person you are trying to reach is no longer/,
  ])) {
    return { category: "bounce", sentiment: "negative" };
  }

  if (matches(text, [
    /out of office/,
    /\booo\b/,
    /\bo\.o\.o\b/,
    /\bo\/o\b/,
    /automatic reply/,
    /automatic response/,
    /automated reply/,
    /automated response/,
    /auto-?reply/,
    /auto(?:mated)? message/,
    /auto(?:mated)? notification/,
    /thank you for your email/,
    /thanks for your email/,
    /thank you for your message/,
    /thanks for your message/,
    /thank you for reaching out/,
    /i have received your email/,
    /we have received your email/,
    /away from (the )?office/,
    /\bi am away\b/,
    /\bi'?m away\b/,
    /\bi am out\b/,
    /\bi'?m out\b/,
    /\bi am currently away\b/,
    /\bcurrently away\b/,
    /\bcurrently unavailable\b/,
    /\bcurrently out of the office\b/,
    /\bnot available\b/,
    /\bunavailable until\b/,
    /\baway until\b/,
    /\bwill return\b/,
    /\bi will be returning\b/,
    /\bi will respond (to your email )?(when|once)/,
    /\bi will get back to you (when|once)/,
    /\bwill respond (when|once)/,
    /\breturn(?:ing)? on\b/,
    /\bback (in|on) (the )?office\b/,
    /\bback at work\b/,
    /\bdo not work (mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b/,
    /\bi work monday to thursday\b/,
    /\blimited access to (my )?email\b/,
    /\bno access to (my )?email\b/,
    /\bdelayed response\b/,
    /\bdelay in (my )?response\b/,
    /annual leave/,
    /vacation/,
    /on leave/,
    /parental leave/,
    /maternity leave/,
    /personal leave/,
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
