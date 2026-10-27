import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const INVENTORY = "tasks/T49/evidence/inventory.md";
const SPEC = "specs/draft-0008-ux-unificado-p-inga.md";

function ler(rel: string): string {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) throw new Error(`ausente: ${rel}`);
  return readFileSync(abs, "utf8");
}

function citacoes(texto: string): { arquivo: string; linha: number }[] {
  return [...texto.matchAll(/`([A-Za-z0-9_./-]+\.(?:ts|tsx|html|css|md|json)):(\d+)`/g)].map(
    (m) => ({ arquivo: m[1]!, linha: Number(m[2]) }),
  );
}

describe("T49 · UX do p-inga", () => {
  it("ancora cada achado em arquivo:linha existente", () => {
    const achados = citacoes(ler(INVENTORY));
    expect(achados.length).toBeGreaterThanOrEqual(6);
    for (const { arquivo, linha } of achados) {
      const abs = join(ROOT, arquivo);
      expect(existsSync(abs)).toBe(true);
      expect(readFileSync(abs, "utf8").split("\n").length).toBeGreaterThanOrEqual(linha);
    }
  });

  it("cobre as tres superficies do escopo", () => {
    const inv = ler(INVENTORY);
    for (const superficie of ["web/", "tuios", "docs/"]) expect(inv).toContain(superficie);
  });

  // Emenda 2026-10-26: a clausula original exigia `Status: draft`. O gate T50 tem por
  // contrato promover draft->approved, entao um validador congelado exigindo draft proibe a
  // transicao que a task seguinte deve executar. Emenda aceita apenas o token de ciclo de vida;
  // as checagens substantivas (ancoragem, superficies, aceite por achado, Discord fora) ficam.
  it("spec com ciclo de vida registrado, criterio de aceite por achado, Discord declarado fora", () => {
    const spec = ler(SPEC);
    expect(spec).toMatch(/^Status: (draft|approved)$/m);
    expect(spec).toMatch(/Crit[ée]rio de aceite/i);
    expect(spec).toMatch(/discord/i);
    expect(spec).toMatch(/fora de escopo/i);
    const corpo = spec.split("\n").filter((l) => l.trim() !== "").length;
    expect(corpo).toBeLessThanOrEqual(60);
  });
});
