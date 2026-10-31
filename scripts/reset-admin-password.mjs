import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}
if (!stdin.isTTY || !stdout.isTTY || !stdin.setRawMode) {
  console.error("Run this command in a local interactive terminal so the password can be entered privately.");
  process.exit(1);
}

const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const rl = createInterface({ input: stdin, output: stdout });

function askHidden(label) {
  return new Promise((resolve, reject) => {
    stdout.write(label);
    let value = "";
    emitKeypressEvents(stdin);
    const terminalSettings = execFileSync("stty", ["-g"], {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "inherit"],
    }).trim();
    stdin.setRawMode(true);
    execFileSync("stty", ["-echo"], { stdio: "inherit" });
    stdin.resume();
    const cleanup = () => {
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(false);
      execFileSync("stty", [terminalSettings], { stdio: "inherit" });
    };
    const onKeypress = (text, key = {}) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        stdout.write("\n");
        reject(new Error("Cancelled."));
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        stdout.write("\n");
        resolve(value);
      } else if (key.name === "backspace") {
        if (value.length) {
          value = value.slice(0, -1);
          stdout.write("\b \b");
        }
      } else if (!key.ctrl && !key.meta && text && !/[\u0000-\u001f\u007f]/.test(text)) {
        value += text;
      }
    };
    stdin.on("keypress", onKeypress);
  });
}

try {
  console.log(`Supabase project: ${projectRef}`);
  const email = (await rl.question("Admin email: ")).trim().toLowerCase();
  const allowlisted = (process.env.ADMIN_EMAILS ?? "")
    .split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean).includes(email);
  if (!email || !email.includes("@")) throw new Error("Enter a valid admin email.");
  if (!allowlisted) {
    throw new Error("That email is not in ADMIN_EMAILS in .env.local. Add the authorized admin email there first, then retry.");
  }

  const password = await askHidden("New password (8+ characters; input hidden): ");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  const confirmation = await askHidden("Confirm new password: ");
  if (password !== confirmation) throw new Error("Passwords do not match.");

  const confirmed = await rl.question(`Set/reset the password for ${email} in project ${projectRef}? Type YES to continue: `);
  if (confirmed.trim() !== "YES") throw new Error("Cancelled; no password was changed.");

  let user = null;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not look up the Auth user: ${error.message}`);
    user = data.users.find((candidate) => candidate.email?.toLowerCase() === email) ?? null;
    if (user || data.users.length < 1000) break;
  }

  if (user) {
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`Could not update the Auth user: ${error.message}`);
  } else {
    const { error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`Could not create the Auth user: ${error.message}`);
  }

  console.log(`Password set for ${email}. Sign in at https://wisdomdrivingacademy.com/admin/login.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Password reset failed.");
  process.exitCode = 1;
} finally {
  rl.close();
}
