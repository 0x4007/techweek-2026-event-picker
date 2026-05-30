#!/usr/bin/env -S deno run

type SnapshotSourceFile = {
  label: string;
  sourcePath: string;
  fallbackPath?: string;
};

type SnapshotManifest = {
  source: {
    repo: string;
    branch: string;
    commit: string;
    fetchedAt: string;
  };
  files: Array<{
    path: string;
    source: string;
    bytes: number;
    chars: number;
  }>;
};

type SnapshotReadResult = {
  text: string;
  source: string;
};

type ParsedArgs = {
  source: string;
  branch: string;
  outDir: string;
};

const DEFAULT_REPO = "https://github.com/ubiquity-os-marketplace/text-conversation-rewards";
const DEFAULT_BRANCH = "main";
const DEFAULT_OUT_DIR = new URL("../docs/text-conversation-rewards/", import.meta.url).pathname;
const USER_AGENT = "techweek-context-snapshot";
const FALLBACK_DOC_ROOT = new URL("../", new URL(".", import.meta.url));

const SNAPSHOT_FILES: readonly SnapshotSourceFile[] = [
  {
    label: "Repository README",
    sourcePath: "README.md",
    fallbackPath: "docs/go-to-market-22-may.md",
  },
  {
    label: "Platform and Accolades context",
    sourcePath: "docs/ubiquity-os-platform-and-accolades-context.md",
    fallbackPath: "docs/go-to-market-22-may.md",
  },
  {
    label: "Accolades whitepaper",
    sourcePath: "docs/ubiquity-os-accolades-whitepaper.md",
    fallbackPath: "docs/go-to-market-22-may.md",
  },
  {
    label: "One-page sales brief",
    sourcePath: "sales-collateral/one-page-sales-brief.md",
    fallbackPath: "docs/go-to-market-22-may.md",
  },
  {
    label: "Buyer discovery",
    sourcePath: "sales-collateral/buyer-discovery.md",
    fallbackPath: "docs/go-to-market-22-may.md",
  },
  {
    label: "Messaging guide",
    sourcePath: "sales-collateral/messaging.md",
    fallbackPath: "docs/go-to-market-22-may.md",
  },
  {
    label: "Event conversation guide",
    sourcePath: "sales-collateral/event-conversation-guide.md",
    fallbackPath: "docs/go-to-market-22-may.md",
  },
  {
    label: "Objection battlecard",
    sourcePath: "sales-collateral/objection-battlecard.md",
    fallbackPath: "docs/go-to-market-22-may.md",
  },
  {
    label: "Buyer persona matrix",
    sourcePath: "sales-collateral/buyer-persona-matrix.md",
    fallbackPath: "docs/go-to-market-22-may.md",
  },
  {
    label: "Visual demo brief",
    sourcePath: "sales-collateral/visual-demo-brief.md",
    fallbackPath: "docs/go-to-market-22-may.md",
  },
  {
    label: "Demo dashboard README",
    sourcePath: "sales-collateral/demo-dashboard/README.md",
    fallbackPath: "docs/go-to-market-22-may.md",
  },
];

async function main(): Promise<void> {
  const args = parseArgs(Deno.args);
  const sourceMode = await normalizeSource(args.source, args.branch);
  const outRoot = new URL(
    args.outDir.endsWith("/") ? args.outDir : `${args.outDir}/`,
    import.meta.url,
  );
  await ensureDir(outRoot);
  await clearDirectory(outRoot);

  const files: SnapshotManifest["files"] = [];
  for (const file of SNAPSHOT_FILES) {
    const outputPath = new URL(file.sourcePath, outRoot);
    const result = await readSourceText(sourceMode, file);
    const text = result.text;
    await ensureDir(new URL(".", outputPath));
    await Deno.writeTextFile(outputPath, text);
    files.push({
      path: file.sourcePath,
      source: result.source,
      bytes: new TextEncoder().encode(text).length,
      chars: text.length,
    });
  }

  const manifest: SnapshotManifest = {
    source: {
      repo: sourceMode.repoUrl,
      branch: sourceMode.branch,
      commit: sourceMode.commit,
      fetchedAt: new Date().toISOString(),
    },
    files,
  };
  await Deno.writeTextFile(
    new URL("manifest.json", outRoot),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`Snapshot written to ${outRoot.pathname}`);
  console.log(`- files: ${files.length}`);
}

type SourceMode = {
  kind: "local";
  repoUrl: string;
  repoPath: string;
  branch: string;
  commit: string;
} | {
  kind: "remote";
  repoUrl: string;
  branch: string;
  commit: string;
  rawBase: string;
};

function parseArgs(argv: string[]): ParsedArgs {
  const output: ParsedArgs = {
    source: DEFAULT_REPO,
    branch: "",
    outDir: DEFAULT_OUT_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") {
      output.source = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--source=")) {
      output.source = arg.slice("--source=".length);
    } else if (arg === "--branch") {
      output.branch = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--branch=")) {
      output.branch = arg.slice("--branch=".length);
    } else if (arg === "--out") {
      output.outDir = requiredValue(argv[++index], arg);
    } else if (arg.startsWith("--out=")) {
      output.outDir = arg.slice("--out=".length);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return output;
}

async function normalizeSource(
  sourceArg: string,
  branch: string,
): Promise<SourceMode> {
  const remoteBranch = branch.trim() || DEFAULT_BRANCH;
  if (await isReadableDirectory(sourceArg)) {
    const repoPath = sourceArg.endsWith("/") ? sourceArg : `${sourceArg}/`;
    const repoUrl = await resolveRepoUrlFromLocal(repoPath).catch(() => DEFAULT_REPO);
    const repoBranch =
      (branch || await gitValue(["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"])) ??
        "";
    if (!repoBranch) {
      throw new Error(`Unable to resolve local git branch for ${repoPath}`);
    }
    const commit = await gitValue(["-C", repoPath, "rev-parse", "HEAD"]);
    if (!commit) {
      throw new Error(`Unable to resolve local git commit for ${repoPath}`);
    }
    return {
      kind: "local",
      repoUrl,
      repoPath,
      branch: repoBranch,
      commit,
    };
  }

  if (!isHttpUrl(sourceArg)) {
    throw new Error(`Source is neither a readable directory nor URL: ${sourceArg}`);
  }

  const repoUrl = sourceArg.replace(/\/$/, "");
  const { owner, repo } = parseGithubRepo(repoUrl);
  const commit = await fetchGitCommitFromApi(owner, repo, remoteBranch);
  const rawBranchPath = remoteBranch.split("/").map(encodeURIComponent).join("/");
  const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${rawBranchPath}/`;
  return { kind: "remote", repoUrl, branch: remoteBranch, commit, rawBase };
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function fileUrlFromRemote(
  source: Extract<SourceMode, { kind: "remote" }>,
  sourcePath: string,
): URL {
  return new URL(encodePath(sourcePath), source.rawBase);
}

function encodePath(value: string): string {
  return value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function snapshotSourceForFileUrl(url: URL): string {
  const root = FALLBACK_DOC_ROOT.href;
  if (url.href.startsWith(root)) {
    return `repo:${decodeURIComponent(url.href.slice(root.length))}`;
  }
  return url.toString();
}

async function readSourceText(
  source: SourceMode,
  file: SnapshotSourceFile,
): Promise<SnapshotReadResult> {
  if (source.kind === "local") {
    try {
      return {
        text: await readTextFromGit(source.repoPath, source.branch, file.sourcePath),
        source: `file://${source.repoPath}${file.sourcePath}`,
      };
    } catch {
      const primary = new URL(file.sourcePath, `file://${source.repoPath}`);
      const fallbackResult = await readTextFileOrFallback(primary, file.fallbackPath);
      return { text: fallbackResult.text, source: fallbackResult.source };
    }
  }
  const remoteSource = fileUrlFromRemote(source, file.sourcePath);
  try {
    const response = await fetch(remoteSource.toString(), {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(`${response.status} ${response.statusText}. ${message}`);
    }
    return {
      text: await response.text(),
      source: remoteSource.toString(),
    };
  } catch (error) {
    if (!file.fallbackPath) {
      throw new Error(
        `Failed to fetch ${file.sourcePath} from ${source.repoUrl}@${source.branch}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const fallbackResult = await readTextFileOrFallback(
      new URL(file.fallbackPath, FALLBACK_DOC_ROOT),
      undefined,
      file.sourcePath,
    );
    return { text: fallbackResult.text, source: fallbackResult.source };
  }
}

async function readTextFileOrFallback(
  primaryUrl: URL,
  fallbackPath: string | undefined,
  label?: string,
): Promise<SnapshotReadResult> {
  try {
    return {
      text: await Deno.readTextFile(primaryUrl),
      source: snapshotSourceForFileUrl(primaryUrl),
    };
  } catch (error) {
    if (!fallbackPath) throw error;
    const fallbackUrl = new URL(fallbackPath, FALLBACK_DOC_ROOT);
    try {
      return {
        text: await Deno.readTextFile(fallbackUrl),
        source: snapshotSourceForFileUrl(fallbackUrl),
      };
    } catch (fallbackError) {
      throw new Error(
        `Unable to read ${
          label || primaryUrl.pathname
        }: missing source and fallback ${fallbackUrl.pathname}. ${String(fallbackError)}`,
      );
    }
  }
}

async function readTextFromGit(repoPath: string, ref: string, sourcePath: string): Promise<string> {
  const output = await gitValue(["-C", repoPath, "show", `${ref}:${sourcePath}`], {
    throwOnError: false,
  });
  if (output === null) throw new Error(`Git show failed for ${ref}:${sourcePath}`);
  return output;
}

async function ensureDir(url: URL): Promise<void> {
  await Deno.mkdir(url, { recursive: true });
}

async function clearDirectory(root: URL): Promise<void> {
  for await (const entry of Deno.readDir(root)) {
    await Deno.remove(new URL(entry.name, root), { recursive: true }).catch(() => {});
  }
}

async function isReadableDirectory(path: string): Promise<boolean> {
  try {
    const info = await Deno.stat(path);
    return info.isDirectory;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    return false;
  }
}

async function gitValue(
  args: string[],
  options: { throwOnError?: boolean } = {},
): Promise<string | null> {
  const { throwOnError = true } = options;
  const command = new Deno.Command("git", { args, stdout: "piped", stderr: "piped" });
  const { code, stdout, stderr } = await command.output();
  if (code !== 0) {
    if (!throwOnError) return null;
    const message = new TextDecoder().decode(stderr || stdout);
    throw new Error(`git command failed: ${message}`);
  }
  return new TextDecoder().decode(stdout).trim();
}

async function fetchGitCommitFromApi(owner: string, repo: string, branch: string): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`,
    {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/vnd.github+json",
      },
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Unable to fetch commit for ${owner}/${repo}@${branch}: ${response.status} ${response.statusText}. ${body}`,
    );
  }
  const payload = await response.json() as { sha: string };
  if (!payload.sha) {
    throw new Error(`Commit API response missing sha for ${owner}/${repo}@${branch}.`);
  }
  return payload.sha;
}

function parseGithubRepo(value: string): { owner: string; repo: string } {
  const githubMatch = value.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/i,
  );
  if (!githubMatch) throw new Error(`Invalid GitHub URL: ${value}`);
  return { owner: githubMatch[1], repo: githubMatch[2] };
}

async function resolveRepoUrlFromLocal(repoPath: string): Promise<string> {
  const remote = await readGitRemote(repoPath);
  if (remote) return remote;
  return DEFAULT_REPO;
}

async function readGitRemote(repoPath: string): Promise<string | null> {
  try {
    const output = await gitValue(["-C", repoPath, "config", "--get", "remote.origin.url"]);
    if (!output) return null;
    if (/^https?:\/\//i.test(output)) return output.replace(/\.git$/, "");
    if (/^git@github\.com:/.test(output)) {
      return `https://github.com/${output.replace(/^git@github\.com:/, "").replace(/\.git$/, "")}`;
    }
  } catch {
    return null;
  }
  return null;
}

function requiredValue(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function printHelp(): never {
  console.log(`Usage: deno run scripts/snapshot_text_conversation_rewards.ts [options]

Required:
  --source=<path-or-url>   Local checkout directory or GitHub URL
  --branch=<name>          Branch name or tag to snapshot (default: ${DEFAULT_BRANCH})
  --out=<path>             Output directory (default: docs/text-conversation-rewards)
`);
  Deno.exit(0);
}

if (import.meta.main) {
  await main();
}
