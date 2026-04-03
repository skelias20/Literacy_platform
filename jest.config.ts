import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  // setup.ts is kept for future use; jest.mock() calls must live in each test file
  // (jest.mock is hoisted per-file; global setup files can't call it)
  testMatch: ["**/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "CommonJS",
          moduleResolution: "node",
        },
      },
    ],
  },
  // Prevent Next.js internals from trying to boot a server
  testPathIgnorePatterns: ["/node_modules/", "/.next/"],
};

export default config;
