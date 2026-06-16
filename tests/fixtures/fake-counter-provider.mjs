import fs from "node:fs";

let stdin = "";
try {
  stdin = fs.readFileSync(0, "utf8");
} catch {
  stdin = "";
}

const counterPath = process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER;
let count = 1;
if (counterPath) {
  try {
    count = Number(fs.readFileSync(counterPath, "utf8")) + 1;
  } catch {
    count = 1;
  }
  fs.writeFileSync(counterPath, String(count));
}

if (
  process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_EXIT_CODE ||
  (process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_FAIL_ON && stdin.includes(process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_FAIL_ON))
) {
  process.stderr.write(process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_STDERR || "fake provider failed");
  process.exit(Number(process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_EXIT_CODE || "1"));
}

if (process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_JSON === "1") {
  process.stdout.write(JSON.stringify({
    text: JSON.stringify({ status: "ok", count })
  }));
} else if (process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_INVALID_JSON === "1") {
  process.stdout.write(JSON.stringify({ text: "not json" }));
} else {
  process.stdout.write(JSON.stringify({
    text: `${process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_TEXT || "live"}-${count}`
  }));
}
