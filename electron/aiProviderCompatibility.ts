const TOOL_ERROR_STATUS = new Set([400, 404, 415, 422, 501]);

export function shouldRetryAIRequestWithoutTools(status: number, responseText: string): boolean {
  if (!TOOL_ERROR_STATUS.has(status)) return false;
  const text = String(responseText || '').toLowerCase();
  const mentionsTools = /(?:tools?|tool_calls?|tool_choice|functions?|function_call)/.test(text);
  const rejectsCapability = /(?:unsupported|not supported|unknown|unrecognized|invalid|not allowed|does not support|unexpected field|extra fields?|schema)/.test(text);
  return mentionsTools && rejectsCapability;
}
