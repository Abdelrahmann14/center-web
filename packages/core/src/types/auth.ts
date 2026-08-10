// Authentication contract, shared by every client.
import type { UUID } from "./common";

/**
 * The role hierarchy: super_admin > admin > user(assistant) > student. A parent
 * is a peer of student - a guardian account linked to one or more students, with
 * no workspace of its own.
 */
export type Role = "super_admin" | "admin" | "user" | "student" | "parent";

/** The authenticated principal returned at login. */
export interface CurrentUser {
  /** Display name, shown throughout the UI. Never used to authenticate. */
  username: string;
  id: UUID;
  /** Login identifier - `<local>@center.{student,admin,assistant}.com`. */
  email: string;
  role: Role;
  /**
   * Effective fine-grained permission codes (e.g. `LESSON_CREATE`), resolved
   * server-side per request under the hierarchical RBAC model. An admin holds
   * every permission of their enabled modules; a super admin holds all. Used by
   * the web app to gate UI. Optional so older/mobile clients that ignore it keep
   * parsing; the backend always sends it.
   */
  permissions?: string[];
  /** Codes of the platform modules enabled for this principal's workspace. */
  modules?: string[];
}

/**
 * Credentials. Every account (admin, assistant, student, super admin) signs in
 * with its email; ownership/role are resolved server-side from the account, not
 * from the address.
 */
export interface LoginRequest {
  email: string;
  password: string;
}

/** Availability of a login name, with alternatives when it is taken. */
export interface EmailAvailability {
  available: boolean;
  /** The full address the local part would become; null when invalid. */
  email: string | null;
  /** Whether the typed local part passes the letters-and-digits rule. */
  valid: boolean;
  suggestions: string[];
}

/** The domain appended to a login name, by role. */
export const EMAIL_DOMAIN: Record<Role, string> = {
  student: "@center.student.com",
  admin: "@center.admin.com",
  super_admin: "@center.admin.com",
  user: "@center.assistant.com",
  parent: "@center.parent.com",
};

export interface LoginResponse {
  token: string;
  user: CurrentUser;
}
