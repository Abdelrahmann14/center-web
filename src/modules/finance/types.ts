/** The Financials contract. Mirrors com.center.finance.dto on the server. */

export type FinanceEntryKind = "income" | "expense";

export interface FinanceEntry {
  id: string;
  lecture_id: string;
  group_id: string | null;
  session_date: string;
  kind: FinanceEntryKind;
  description: string;
  amount: number;
  version: number;
}

/** One payment bucket: everybody on the same amount. */
export interface InvoiceLine {
  /** null = the student has no price set at all. */
  price: number | null;
  count: number;
  subtotal: number;
  discounted: boolean;
}

/** One lesson session, read as an invoice. Derived server-side on every read. */
export interface Invoice {
  /** `lecture:group:date` - the session's identity; it has no id of its own. */
  key: string;
  lecture_id: string;
  lecture_name: string;
  group_id: string | null;
  group_label: string;
  center_name: string | null;
  grade: string | null;
  session_date: string;
  start_time: string | null;
  students: number;
  attended: number;
  lesson_price: number;
  lines: InvoiceLine[];
  gross: number;
  percentage: number;
  center_cut: number;
  net_after_cut: number;
  entries: FinanceEntry[];
  other_income: number;
  other_expense: number;
  total: number;
  /** Names of the assistants marked present at this session. */
  attendees: string[];
}

/** One assistant in the attendance picker, with their current present state. */
export interface AssistantAttendance {
  id: string;
  name: string;
  attended: boolean;
}
