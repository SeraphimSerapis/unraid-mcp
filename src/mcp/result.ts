export function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

export function jsonResult(title: string, value: unknown) {
  return textResult(`${title}\n\n${JSON.stringify(value, null, 2)}`, {
    result: value as Record<string, unknown>,
  });
}

export function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
