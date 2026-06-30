#!/usr/bin/env node

console.warn(
  [
    "",
    "[deprecated] @prmflow/openflow has moved to @travisliu/open-dynamic-workflow.",
    "Please migrate to:",
    "  npx @travisliu/open-dynamic-workflow ...",
    "",
    "This compatibility wrapper will forward commands for now.",
    ""
  ].join("\n")
);

try {
  const { runCli } = await import("@travisliu/open-dynamic-workflow/cli");
  await runCli(process.argv.slice(2));
} catch (error) {
  console.error(
    "Failed to start @travisliu/open-dynamic-workflow from the @prmflow/openflow compatibility wrapper."
  );

  if (error && typeof error === "object" && "stack" in error) {
    console.error(error.stack);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
}
