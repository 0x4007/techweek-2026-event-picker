function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function runPrepareDeployRoot(path: string): Promise<Deno.CommandOutput> {
  const command = new Deno.Command("bash", {
    args: ["scripts/prepare_deno_deploy_root.sh", path],
    stdout: "piped",
    stderr: "piped",
  });
  return await command.output();
}

Deno.test("prepare deploy root rejects dangerous roots", async () => {
  const dangerousRoots = [".", "..", "/", Deno.cwd(), Deno.env.get("HOME") ?? ""].filter(Boolean);
  for (const root of dangerousRoots) {
    const output = await runPrepareDeployRoot(root);
    assert(output.code !== 0, `Expected ${root} to be rejected.`);
  }
});

Deno.test("prepare deploy root rejects non-deploy temp directory without deleting it", async () => {
  const tempRoot = await Deno.makeTempDir();
  const marker = `${tempRoot}/keep.txt`;
  await Deno.writeTextFile(marker, "do not delete");
  try {
    const output = await runPrepareDeployRoot(tempRoot);
    assert(output.code !== 0, "Expected non-deploy temp directory to be rejected.");
    assert(await exists(marker), "Expected rejected directory marker to remain.");
  } finally {
    await Deno.remove(tempRoot, { recursive: true }).catch(() => {});
  }
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
