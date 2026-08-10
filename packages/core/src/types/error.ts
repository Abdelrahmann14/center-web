// Error models. The backend speaks RFC 7807 ProblemDetail; its `detail` member
// carries the user-facing (Arabic) message.

export interface ProblemDetail {
  type?: string;
  title?: string;
  status?: number;
  /** The human-readable, user-facing message. */
  detail?: string;
  instance?: string;
  /** Handlers may add extra members (e.g. field errors). */
  [key: string]: unknown;
}

/** Thrown by the HTTP client for any non-2xx response. */
export class ApiError extends Error {
  readonly status: number;
  /** The user-facing message (from ProblemDetail.detail, or a fallback). */
  readonly detail: string;
  readonly problem?: ProblemDetail;

  constructor(detail: string, status: number, problem?: ProblemDetail) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.problem = problem;
  }
}
