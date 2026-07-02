export function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

export function jsonResult(title: string, value: unknown, summary = "Structured result attached.") {
  return textResult(`${title}: ${summary}`, {
    result: value as Record<string, unknown>,
  });
}

export function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
