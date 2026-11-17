import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

export function validateLocalEnvironment(env) {
  const errors = [];

  if (env.WDA_APP_ENV !== "local") {
    errors.push("Set WDA_APP_ENV=local in .env.local before starting local development.");
  }

  const hasSupabaseCredentials = Boolean(
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  if (hasSupabaseCredentials && !supabaseUrl) {
    errors.push("Supabase keys are configured without a local Supabase URL.");
  }
  if (supabaseUrl) {
    try {
      const url = new URL(supabaseUrl);
      const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
      if (url.protocol !== "http:" || !localHosts.has(url.hostname)) {
        errors.push("Local development may connect only to a loopback Supabase URL.");
      }
    } catch {
      errors.push("NEXT_PUBLIC_SUPABASE_URL is not a valid local URL.");
    }
  }

  const stripeKey = env.STRIPE_SECRET_KEY;
  if (stripeKey && !/^(?:sk|rk)_test_[A-Za-z0-9]+$/.test(stripeKey)) {
    errors.push("Local development accepts only a valid Stripe Test Mode secret key.");
  }
  if (env.STRIPE_LIVE_PAYMENTS_ENABLED === "true") {
    errors.push("Live Stripe payments must never be enabled in local development.");
  }
  if (env.RESEND_API_KEY) {
    errors.push("Do not configure an external email API key locally; use synthetic data and the console fallback.");
  }

  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.env.NODE_ENV = "development";
  loadEnvConfig(process.cwd(), true);
  const errors = validateLocalEnvironment(process.env);
  if (errors.length > 0) {
    console.error("Local development startup blocked:");
    for (const error of errors) console.error(`- ${error}`);
    console.error("No credentials or environment values were printed. See docs/data-safety-and-release-workflow.md.");
    process.exit(1);
  }

  const nextBin = process.platform === "win32" ? "next.cmd" : "next";
  const child = spawn(nextBin, ["dev", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("error", (error) => {
    console.error(`Could not start Next.js: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1);
  });
}
