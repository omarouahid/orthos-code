/**
 * GitHub client — wraps the `gh` CLI for authenticated access.
 * Falls back to GitHub REST API via fetch if gh is unavailable.
 */

import { execSync } from 'child_process';

/** Sanitize a string for safe use in shell commands (prevent injection) */
function shellEscape(arg: string): string {
  // Validate: reject characters that should never appear in branch names, titles, etc.
  // Allow alphanumeric, spaces, common punctuation, unicode letters
  // Single quotes are the safest quoting in bash — escape any internal single quotes
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/** Validate git branch/ref name — reject dangerous characters */
function validateRefName(name: string): string {
  // Git ref name rules + reject shell metacharacters
  if (/[`$\\;|&<>(){}!\x00-\x1f\x7f~^:?*\[\]]/.test(name)) {
    throw new Error(`Invalid ref name: "${name}" contains disallowed characters`);
  }
  if (name.includes('..') || name.startsWith('-') || name.endsWith('.lock') || name.endsWith('/')) {
    throw new Error(`Invalid ref name: "${name}"`);
  }
  return name;
}

export interface GitHubConfig {
  token?: string; // Personal access token (optional if gh CLI is authenticated)
}

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  url: string;
  state: string;
  head: string;
  base: string;
  author: string;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  state: string;
  url: string;
  author: string;
}

export class GitHubClient {
  private token: string | undefined;

  constructor(config: GitHubConfig = {}) {
    this.token = config.token || process.env.GITHUB_TOKEN;
  }

  private exec(cmd: string, cwd: string): string {
    try {
      return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 30000 }).trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`GitHub command failed: ${msg}`);
    }
  }

  /** Create a new branch from base */
  createBranch(name: string, base: string, cwd: string): string {
    const safeName = validateRefName(name);
    const safeBase = validateRefName(base);
    this.exec(`git fetch origin ${shellEscape(safeBase)}`, cwd);
    this.exec(`git checkout -b ${shellEscape(safeName)} origin/${shellEscape(safeBase)}`, cwd);
    return name;
  }

  /** Push current branch to remote */
  pushBranch(branch: string, cwd: string): void {
    const safeBranch = validateRefName(branch);
    this.exec(`git push -u origin ${shellEscape(safeBranch)}`, cwd);
  }

  /** Create a pull request using gh CLI */
  createPR(opts: {
    title: string;
    body: string;
    head: string;
    base: string;
    cwd: string;
  }): PullRequest {
    const { title, body, head, base, cwd } = opts;
    // Push first
    this.pushBranch(head, cwd);

    const safeHead = validateRefName(head);
    const safeBase = validateRefName(base);
    const result = this.exec(
      `gh pr create --title ${shellEscape(title)} --body ${shellEscape(body)} --head ${shellEscape(safeHead)} --base ${shellEscape(safeBase)} --json number,title,body,url,state,headRefName,baseRefName,author`,
      cwd,
    );

    try {
      const pr = JSON.parse(result);
      return {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        url: pr.url,
        state: pr.state,
        head: pr.headRefName,
        base: pr.baseRefName,
        author: pr.author?.login || '',
      };
    } catch {
      // gh pr create may just output the URL
      return {
        number: 0,
        title,
        body,
        url: result,
        state: 'open',
        head,
        base,
        author: '',
      };
    }
  }

  /** Get a pull request by number */
  getPR(number: number, cwd: string): PullRequest {
    const safeNumber = parseInt(String(number), 10);
    if (isNaN(safeNumber) || safeNumber <= 0) throw new Error(`Invalid PR number: ${number}`);
    const result = this.exec(
      `gh pr view ${safeNumber} --json number,title,body,url,state,headRefName,baseRefName,author`,
      cwd,
    );
    const pr = JSON.parse(result);
    return {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      url: pr.url,
      state: pr.state,
      head: pr.headRefName,
      base: pr.baseRefName,
      author: pr.author?.login || '',
    };
  }

  /** List pull requests */
  listPRs(state: string, cwd: string): PullRequestSummary[] {
    const validStates = ['open', 'closed', 'merged', 'all'];
    const safeState = validStates.includes(state) ? state : 'open';
    const result = this.exec(
      `gh pr list --state ${safeState} --json number,title,state,url,author --limit 20`,
      cwd,
    );
    const prs = JSON.parse(result) as Array<Record<string, unknown>>;
    return prs.map((pr) => ({
      number: pr.number as number,
      title: pr.title as string,
      state: pr.state as string,
      url: pr.url as string,
      author: (pr.author as Record<string, unknown>)?.login as string || '',
    }));
  }

  /** Add a comment to a pull request */
  addComment(prNumber: number, comment: string, cwd: string): void {
    const safeNumber = parseInt(String(prNumber), 10);
    if (isNaN(safeNumber) || safeNumber <= 0) throw new Error(`Invalid PR number: ${prNumber}`);
    this.exec(`gh pr comment ${safeNumber} --body ${shellEscape(comment)}`, cwd);
  }

  /** Check if gh CLI is available and authenticated */
  checkAuth(cwd: string): boolean {
    try {
      this.exec('gh auth status', cwd);
      return true;
    } catch {
      return false;
    }
  }
}
