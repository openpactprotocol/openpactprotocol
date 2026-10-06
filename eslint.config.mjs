import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/.next/**", "**/node_modules/**", "**/drizzle/**", "**/next-env.d.ts"] },
  ...tseslint.configs.recommended,
);
