import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/**
 * eslint-config-next 16 ships flat config directly, so it is spread in as-is.
 * Routing it through `FlatCompat` (the older pattern) throws a circular-JSON
 * error while validating the legacy schema.
 */
const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "out/**"],
  },
];

export default eslintConfig;
