// A user avatar: the uploaded profile photo when present, otherwise the first
// letter of the name on a soft accent circle. Used across the super admin console.

const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-20 w-20 text-2xl",
} as const;

export function Avatar({
  photo,
  name,
  size = "md",
}: {
  photo?: string | null;
  name: string;
  size?: keyof typeof SIZES;
}) {
  const cls = `${SIZES[size]} shrink-0 overflow-hidden rounded-full`;
  if (photo) {
    return <img src={photo} alt={name} className={`${cls} object-cover`} />;
  }
  const letter = name?.trim()?.[0] ?? "؟";
  return (
    <div className={`${cls} flex items-center justify-center bg-accent/10 font-bold text-accent`}>
      {letter}
    </div>
  );
}
