// Emits theme.css from tokens.js so Tailwind's @theme stays in lockstep with the
// canonical token values. Run: npm -w @center/design-tokens run generate

import { writeFileSync } from "node:fs";
import { tailwindColors } from "./tokens.js";

const lines = Object.entries(tailwindColors).map(([name, value]) => `  --color-${name}: ${value};`);

const css = `/* GENERATED from tokens.js by generate-theme.mjs — do not edit by hand.
   Run \`npm run generate\` in @center/design-tokens after changing tokens. */
@theme {
${lines.join("\n")}
}
`;

writeFileSync(new URL("./theme.css", import.meta.url), css);
console.log(`theme.css written (${lines.length} color tokens)`);
