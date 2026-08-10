// The SyncTransport port over the web HTTP client (which already carries the
// bearer token and the X-Act-As-Admin header), pointed at /api/sync.
import type { PullResponse, PushRequest, PushResponse, SyncTransport } from "@center/core";
import { api } from "@/lib/api";

export class HttpSyncTransport implements SyncTransport {
  push(req: PushRequest): Promise<PushResponse> {
    return api.post<PushResponse>("/sync/push", req);
  }

  pull(since: string | null, limit: number): Promise<PullResponse> {
    const params = new URLSearchParams();
    if (since) params.set("since", since);
    params.set("limit", String(limit));
    return api.get<PullResponse>(`/sync/pull?${params.toString()}`);
  }
}
