import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  db,
  userTable,
  sessionTable,
  accountTable,
  verificationTable,
} from "@workspace/db";

if (!process.env["BETTER_AUTH_SECRET"]) {
  throw new Error(
    "BETTER_AUTH_SECRET environment variable is required but was not provided.",
  );
}

const trustedOrigins =
  process.env["BETTER_AUTH_TRUSTED_ORIGINS"]
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? [];

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: userTable,
      session: sessionTable,
      account: accountTable,
      verification: verificationTable,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
  },
  secret: process.env["BETTER_AUTH_SECRET"],
  baseURL: process.env["BETTER_AUTH_URL"],
  trustedOrigins,
});
