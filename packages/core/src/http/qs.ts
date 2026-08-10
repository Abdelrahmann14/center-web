// Query-string builder. Empty values are dropped so they can't accidentally
// narrow a search. Reminder: Spring binds query params by camelCase property
// name (groupId, sort=createdAt), even though response bodies are snake_case.

export type QueryValue = string | number | boolean | null | undefined;

export function qs(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    search.append(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : "";
}
