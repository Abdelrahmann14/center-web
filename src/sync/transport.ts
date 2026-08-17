// The SyncTransport port over the web app's HTTP client (which already carries
// the bearer token set at login and the same-origin /api base), pointed at the
// Spring /api/sync endpoints. Mirror of the mobile transport.
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
