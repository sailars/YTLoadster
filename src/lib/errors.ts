export function sanitizeTechnicalError(message: string, toolReplacement: string) {
  const errorStart = message.lastIndexOf("ERROR:");
  const relevantMessage = errorStart >= 0 ? message.slice(errorStart) : message;

  return relevantMessage
    .replace(/\[[^\]]*]\(https?:\/\/[^)\s]+\)/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/yt[-_]dlp/gi, toolReplacement)
    .replace(/\bsee\s+(?:for more info|for details)\b[.:]?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function isYouTubeRateLimitError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("http error 429") ||
    normalized.includes("429: too many requests") ||
    normalized.includes("ошибка 429")
  );
}

export function isYouTubeAgeRestrictionError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("sign in to confirm your age") ||
    normalized.includes("confirm your age to watch") ||
    normalized.includes("требует войти в аккаунт и подтвердить возраст")
  );
}

export function isYouTubeBotConfirmationError(message: string) {
  const normalized = message.toLowerCase();
  return (
    /sign in to confirm you(?:'|’)?re not a bot/.test(normalized) ||
    normalized.includes("sign in to confirm you are not a bot") ||
    normalized.includes("youtube просит подтвердить, что вы не робот")
  );
}
