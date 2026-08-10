// Academic tracks (الشعبة) are dynamic per grade. A grade carries a track_kind
// that determines which track options its students may pick.

export type TrackKind = "none" | "g11" | "g12";

export const TRACK_OPTIONS: Record<TrackKind, string[]> = {
  none: [],
  g11: ["علمي", "أدبي"],
  g12: ["علمي علوم", "علمي رياضة", "أدبي"],
};

// All distinct track values across kinds (used for the Students filter).
export const ALL_TRACKS: string[] = Array.from(
  new Set(Object.values(TRACK_OPTIONS).flat())
);

export const GENDERS = ["ذكر", "أنثى"];
export const RELIGIONS = ["مسلم", "مسيحي"];
