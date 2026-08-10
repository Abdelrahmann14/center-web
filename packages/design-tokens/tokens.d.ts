// Types for consumers of the canonical token module.

export declare const color: {
  accent: string;
  accentHover: string;
  dark: string;
  danger: string;
  success: string;
  warning: string;
  surface: string;
  page: string;
  border: string;
  textMuted: string;
};

export declare const tailwindColors: Record<string, string>;

export declare const radius: { control: string; card: string };

export declare const font: { arabic: string };

declare const tokens: {
  color: typeof color;
  tailwindColors: typeof tailwindColors;
  radius: typeof radius;
  font: typeof font;
};
export default tokens;
