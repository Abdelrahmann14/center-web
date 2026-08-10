// Framework-agnostic HTTP client. Uses the global `fetch` (present in browsers,
// React Native, and Node 18+/Electron), so it runs unchanged on every psycho
// client. No React, no DOM assumptions beyond fetch.

import { ApiError, type ProblemDetail } from "../types/error";
import { qs, type QueryValue } from "./qs";

export interface RequestOptions {
  /** Query params appended to the path (empty values dropped). */
  query?: Record<string, QueryValue>;
  /** Extra headers for this request only. */
  headers?: Record<string, string>;
  /** JSON request body. */
  body?: unknown;
  /** Abort/cancel signal. */
  signal?: AbortSignal;
  /** Skip the Authorization header (e.g. the login call). */
  anonymous?: boolean;
}

/** Mutable request description handed to interceptors before the fetch. */
export interface RequestContext {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  options: RequestOptions;
}

export type RequestInterceptor = (ctx: RequestContext) => void | Promise<void>;
export type ResponseInterceptor = (res: Response, ctx: RequestContext) => void | Promise<void>;

export interface HttpClientConfig {
  /** Base URL prefixed to every path, e.g. "/api" or "http://host:8001/api". */
  baseUrl: string;
  /** Overrides the internally-set token when provided. */
  getToken?: () => string | null | undefined;
  /** Invoked once a 401 is final (no refresh, or refresh failed). */
  onUnauthorized?: () => void;
  /**
   * Called on a 401 to obtain a fresh token. Return true to retry the request
   * once. The backend has no refresh endpoint yet - this is the seam for when it
   * does, so adding refresh later needs no client changes.
   */
  refresh?: () => Promise<boolean>;
  requestInterceptors?: RequestInterceptor[];
  responseInterceptors?: ResponseInterceptor[];
  /** User-facing message when the server sends no ProblemDetail.detail. */
  defaultErrorMessage?: string;
}

export class HttpClient {
  private token: string | null = null;
  private readonly headers = new Map<string, string>();
  private readonly requestInterceptors: RequestInterceptor[];
  private readonly responseInterceptors: ResponseInterceptor[];

  constructor(private readonly config: HttpClientConfig) {
    this.requestInterceptors = [...(config.requestInterceptors ?? [])];
    this.responseInterceptors = [...(config.responseInterceptors ?? [])];
  }

  /** Store the bearer token (kept in memory; persistence is the caller's job). */
  setToken(token: string | null): void {
    this.token = token;
  }

  getToken(): string | null {
    return this.config.getToken?.() ?? this.token;
  }

  /**
   * Set or clear a header sent on every request. Null removes it. Used e.g. by
   * the web app to attach X-Act-As-Admin while a super admin browses a workspace.
   */
  setHeader(name: string, value: string | null): void {
    if (value == null) this.headers.delete(name);
    else this.headers.set(name, value);
  }

  addRequestInterceptor(interceptor: RequestInterceptor): void {
    this.requestInterceptors.push(interceptor);
  }

  addResponseInterceptor(interceptor: ResponseInterceptor): void {
    this.responseInterceptors.push(interceptor);
  }

  request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    return this.exec<T>(method, path, options, false);
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, { ...options, body });
  }

  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("PUT", path, { ...options, body });
  }

  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("PATCH", path, { ...options, body });
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, options);
  }

  private async exec<T>(
    method: string,
    path: string,
    options: RequestOptions,
    retried: boolean,
  ): Promise<T> {
    const url = this.config.baseUrl + path + (options.query ? qs(options.query) : "");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...Object.fromEntries(this.headers),
      ...(options.headers ?? {}),
    };
    const token = this.getToken();
    if (token && !options.anonymous) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const ctx: RequestContext = { method, url, headers, body: options.body, options };
    for (const interceptor of this.requestInterceptors) {
      await interceptor(ctx);
    }

    const res = await fetch(ctx.url, {
      method,
      headers: ctx.headers,
      body: ctx.body === undefined ? undefined : JSON.stringify(ctx.body),
      signal: options.signal,
    });

    for (const interceptor of this.responseInterceptors) {
      await interceptor(res, ctx);
    }

    // One-shot refresh-and-retry seam.
    if (res.status === 401 && !retried && this.config.refresh) {
      const refreshed = await this.config.refresh();
      if (refreshed) {
        return this.exec<T>(method, path, options, true);
      }
    }

    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      if (res.status === 401) {
        this.config.onUnauthorized?.();
      }
      const problem =
        data && typeof data === "object" ? (data as ProblemDetail) : undefined;
      const detail =
        problem?.detail ?? this.config.defaultErrorMessage ?? "Request failed";
      throw new ApiError(String(detail), res.status, problem);
    }

    return data as T;
  }
}
