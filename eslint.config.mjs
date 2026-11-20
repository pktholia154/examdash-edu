import { defineConfig } from "eslint/config";
import next from "eslint-config-next";
import firebaseRulesPlugin from "@firebase/eslint-plugin-security-rules";

export default defineConfig([
  {
    ignores: ["dist/**/*", ".next/**/*", "node_modules/**/*", ".playwright-cli/**/*"],
  },
  ...next,
  firebaseRulesPlugin.configs["flat/recommended"],
]);
