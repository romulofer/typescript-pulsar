// @ts-check
const eslint = require("@eslint/js")
const tseslint = require("typescript-eslint")
const globals = require("globals")

module.exports = tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "lib/typings/atom-config.d.ts"],
  },
  {
    files: ["lib/**/*.{ts,tsx}", "spec/**/*.{ts,tsx}"],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.ts"],
        },
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // house style: unused args/locals are already caught by tsc's noUnusedParameters/
      // noUnusedLocals in lib/tsconfig.json; avoid flagging the same thing twice.
      "@typescript-eslint/no-unused-vars": "off",
      // this codebase uses `any` deliberately in a handful of LSP boundary/adapter spots
      // (see AGENTS.md); keep it a warning, not a hard error, rather than scattering
      // eslint-disable comments through otherwise-fine code.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-empty-function": "off",
      "no-empty": "off",
    },
  },
  {
    // Ambient typings adapted from React's own JSX HTMLAttributes (etch.d.ts) and TypeScript's
    // own lib.d.ts CallableFunction.bind signature (typings.d.ts). `any` here matches the
    // upstream conventions being described, not something to give real types.
    files: ["lib/typings/**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["scripts/**/*.js"],
    extends: [eslint.configs.recommended],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
  },
)
