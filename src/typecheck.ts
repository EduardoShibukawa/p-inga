import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";

export type PreflightResult = {
  ok: boolean;
  diagnostics?: string;
  toolUsed: "bun" | "python" | "none";
};

/**
 * Pre-Flight Type & Syntax Check Hook.
 * Executa uma verificação estática ultrarrápida no arquivo após uma edição ou escrita,
 * alertando o agente sobre erros de sintaxe ou tipagem imediatamente.
 */
export function preflightCheck(filePath: string, cwd: string = process.cwd()): PreflightResult {
  const fullPath = resolve(cwd, filePath);
  if (!existsSync(fullPath)) {
    return { ok: false, diagnostics: `Arquivo não encontrado: ${filePath}`, toolUsed: "none" };
  }

  const ext = extname(filePath).toLowerCase();

  if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx") {
    // Bun build dry-run para syntax & export verification
    const proc = Bun.spawnSync(["bun", "build", "--no-bundle", fullPath], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (proc.exitCode !== 0) {
      const errOut = proc.stderr.toString().trim() || proc.stdout.toString().trim();
      return {
        ok: false,
        diagnostics: `DIAGNÓSTICO ESTÁTICO (TypeScript/Bun):\n${errOut}`,
        toolUsed: "bun",
      };
    }
    return { ok: true, toolUsed: "bun" };
  }

  if (ext === ".py") {
    // Python py_compile check
    const proc = Bun.spawnSync(["python3", "-m", "py_compile", fullPath], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (proc.exitCode !== 0) {
      const errOut = proc.stderr.toString().trim();
      return {
        ok: false,
        diagnostics: `DIAGNÓSTICO ESTÁTICO (Python):\n${errOut}`,
        toolUsed: "python",
      };
    }
    return { ok: true, toolUsed: "python" };
  }

  return { ok: true, toolUsed: "none" };
}
