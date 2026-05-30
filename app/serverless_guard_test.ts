function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readRepoText(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(`../${path}`, import.meta.url));
}

Deno.test("serverless runtime has no local OCR, auth-file, or external context dependencies", async () => {
  const server = await readRepoText("app/server.ts");
  const main = await readRepoText("app/main.ts");
  const denoConfig = JSON.parse(await readRepoText("deno.json")) as {
    unstable?: string[];
    tasks?: Record<string, string>;
    deploy?: {
      runtime?: {
        entrypoint?: string;
      };
    };
  };
  const workflow = await readRepoText(".github/workflows/deno-deploy.yml");
  const deployRootScript = await readRepoText("scripts/prepare_deno_deploy_root.sh");
  const runtimeText = `${server}\n${main}`;

  const forbiddenRuntimeTerms = [
    "Deno.Command",
    "tesseract",
    "magick",
    ".codex/ocr-local",
    "defaultAuthFilePath",
    "readStoredPartifulAuth",
    "/Users/nv/repos/ubiquity-os-marketplace/text-conversation-rewards",
  ];
  for (const term of forbiddenRuntimeTerms) {
    assert(!runtimeText.includes(term), `Runtime should not contain ${term}`);
  }
  assert(!/\bauthFile\b/.test(runtimeText), "Runtime should not contain server authFile paths.");

  const cronIndex = main.indexOf("Deno.cron(");
  const serveIndex = main.indexOf("startServer()");
  assert(cronIndex >= 0, "Expected app/main.ts to register Deno.cron.");
  assert(serveIndex >= 0, "Expected app/main.ts to start the server.");
  assert(cronIndex < serveIndex, "Deno.cron must be registered before Deno.serve starts.");
  assert(
    server.includes('PARTIFUL_AUTO_SYNC_CRON_EXPRESSION = "* * * * *"'),
    "Partiful auto-sync cron must run every minute.",
  );

  for (const taskName of ["dev", "start"]) {
    const task = denoConfig.tasks?.[taskName] ?? "";
    assert(task.includes("app/main.ts"), `${taskName} task should start app/main.ts.`);
    assert(!task.includes("tesseract"), `${taskName} task should not allow tesseract.`);
    assert(!task.includes("magick"), `${taskName} task should not allow magick.`);
    assert(!task.includes("--allow-run"), `${taskName} task should not grant process execution.`);
    assert(
      !task.includes("/Users/nv/repos/ubiquity-os-marketplace/text-conversation-rewards"),
      `${taskName} task should not read an external checkout.`,
    );
  }

  assert(workflow.includes("ENTRYPOINT: app/main.ts"), "Deploy workflow should use app/main.ts.");
  assert(
    workflow.includes("deno deploy") && workflow.includes("--prod"),
    "Deploy workflow should publish production with deno deploy.",
  );
  assert(
    workflow.includes("--config deno.json"),
    "Deploy workflow should use the bundled Deno Deploy config.",
  );
  assert(
    workflow.includes("${{ runner.temp }}/techweek-deploy-root"),
    "Deploy workflow should stage deploy files outside the ignored repo worktree.",
  );
  assert(
    denoConfig.deploy?.runtime?.entrypoint === "app/main.ts",
    "Deno Deploy config should use app/main.ts.",
  );
  assert(denoConfig.unstable?.includes("cron"), "Deno config should enable Deno.cron.");
  assert(denoConfig.unstable?.includes("kv"), "Deno config should enable Deno.openKv.");
  assert(
    deployRootScript.includes("docs/text-conversation-rewards"),
    "Deploy root should include bundled product context.",
  );

  const bundledContextFiles = [
    "manifest.json",
    "README.md",
    "docs/ubiquity-os-platform-and-accolades-context.md",
    "docs/ubiquity-os-accolades-whitepaper.md",
    "sales-collateral/one-page-sales-brief.md",
    "sales-collateral/buyer-discovery.md",
    "sales-collateral/messaging.md",
    "sales-collateral/event-conversation-guide.md",
    "sales-collateral/objection-battlecard.md",
    "sales-collateral/buyer-persona-matrix.md",
    "sales-collateral/visual-demo-brief.md",
    "sales-collateral/demo-dashboard/README.md",
  ];
  for (const path of bundledContextFiles) {
    await Deno.stat(new URL(`../docs/text-conversation-rewards/${path}`, import.meta.url));
  }
});
