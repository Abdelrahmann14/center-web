// @center/core - the shared SDK every center frontend consumes instead of
// duplicating API logic. Framework-agnostic (no React, no DOM beyond fetch).
//
// Growth without breaking changes: add new types under types/ and new resource
// clients (e.g. an StudentsApi built on HttpClient) under a future resources/,
// then re-export them here. Existing exports stay stable.

export * from "./types/common";
export * from "./types/pagination";
export * from "./types/auth";
export * from "./types/error";
export * from "./http/qs";
export * from "./http/client";
export * from "./sync";
