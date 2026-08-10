// Shared shapes for the Exams module. Response bodies are snake_case (the server
// contract); these mirror them.
export type LabelStyle = "arabic" | "english";

export interface Exam {
  id: string;
  lecture_id: string;
  lecture_name: string | null;
  name: string;
  grade: string | null;
  max_score: number | null;
  duration_minutes: number;
  scheduled_date: string | null;
  group_ids: string[];
  label_style: LabelStyle;
  allow_multiple_correct: boolean;
  notes_enabled: boolean;
  bonus_enabled: boolean;
  /** Publishable state: true once every validation passes. */
  complete: boolean;
  /** Legacy single password; per-group passwords now live in group_passwords. */
  exam_password: string | null;
  /** One password per assigned group, regenerated on every publish. */
  group_passwords: GroupPassword[];
  /** True once published to students. */
  published: boolean;
  question_count: number;
}

export interface GroupPassword {
  group_id: string;
  password: string;
}

export interface ExamChoice {
  id?: string;
  label: string;
  text: string;
  correct: boolean;
  position?: number;
}

export interface ExamQuestion {
  id?: string;
  text: string;
  position?: number;
  score: number;
  allow_multiple: boolean;
  bonus: boolean;
  bonus_score: number | null;
  /** null = no note box; string (incl. "") = note box shown/authored. */
  note: string | null;
  choices: ExamChoice[];
}

export interface ExamDetail extends Omit<Exam, "question_count"> {
  questions: ExamQuestion[];
}

export interface LectureLite {
  id: string;
  name: string;
  grade: string | null;
  exam_name: string | null;
  exam_grade: string | null;
}

/** The exam-score cap stored on a lesson is free text; take its first number. */
export function parseMaxScore(examGrade: string | null): string {
  const m = String(examGrade ?? "").match(/\d+(\.\d+)?/);
  return m ? m[0] : "";
}

// Answer-label sequences per style; applied automatically to every question.
const LABELS: Record<LabelStyle, string[]> = {
  arabic: ["أ", "ب", "ج", "د", "هـ", "و", "ز", "ح", "ط", "ي"],
  english: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
};

export function labelFor(style: LabelStyle, index: number): string {
  return LABELS[style][index] ?? String(index + 1);
}

/** Positive whole number or one ending in .5 (no finer precision). */
export function isHalfStep(value: number): boolean {
  return Number.isFinite(value) && value > 0 && Number.isInteger(value * 2);
}

/** Today's date as YYYY-MM-DD in LOCAL time (for date-input min / past-date checks). */
export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
