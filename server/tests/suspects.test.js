// SPDX-License-Identifier: MIT
// Port of tests/test_suspects.py — the suspect list: spread + banded ranking. The measured
// behaviours: identical passes are never suspects, accents survive tokenisation, short
// strings get slots the long ones would otherwise take, and the finding carries the
// ALTERNATIVE rendering.
import { expect, test } from "vitest";
import { rankSuspects, spread } from "../src/suspects.js";

test("spread_zero_for_same_words_one_for_disjoint", () => {
  expect(spread("Eliminar nota", "Eliminar nota")).toBe(0);
  expect(spread("Eliminar nota", "nota Eliminar"), "word order does not register").toBe(0);
  expect(spread("Eliminar la nota", "eliminar   la NOTA."), "case/punct/spacing ignored").toBe(0);
  expect(spread("uno dos", "tres cuatro")).toBe(1);
  const s = spread("Eliminar la nota", "Borrar la nota");
  expect(s > 0 && s < 1).toBe(true);
});

test("spread_is_accent_aware", () => {
  // Unicode tokenisation: "capítulo" must not degrade to "cap tulo".
  expect(spread("el capítulo", "el capitulo"), "an accent difference IS a difference").toBeGreaterThan(0);
});

test("identical_passes_are_never_suspects", () => {
  const findings = rankSuspects({
    sourceFlat: { a: "Delete", b: "Save" },
    targetFlat: { a: "Eliminar", b: "Guardar" },
    probeFlat: { a: "Eliminar", b: "Guardar" },
  });
  expect(findings).toEqual([]);
});

test("disagreement_findings_carry_the_alternative_rendering", () => {
  const findings = rankSuspects({ sourceFlat: { a: "Collapse" }, targetFlat: { a: "Contraer" }, probeFlat: { a: "Colapsar" } });
  expect(findings.length).toBe(1);
  const f = findings[0];
  expect(f.key === "a" && f.code === "disagreement").toBe(true);
  // The alternative IS the useful part: the reviewer judges by seeing what the second pass
  // said. A bare score would send them digging.
  expect(f.detail).toContain("Colapsar");
  expect(f.detail).toContain("spread");
});

test("banding_gives_short_strings_slots_long_ones_would_take", () => {
  // Three short keys with small spreads, three long paragraphs with big spreads. A flat top-3
  // would be all paragraphs; banding must let short strings through — the "End" ->
  // "Finalizar" class of defect is three characters of source.
  const source = {
    s1: "End",
    s2: "Top",
    s3: "Add",
    l1: "A long paragraph about chapters and drafts ".repeat(4),
    l2: "Another long paragraph about notes and books ".repeat(4),
    l3: "Yet another long paragraph about experts and prose ".repeat(4),
  };
  const target = {
    s1: "Fin",
    s2: "Cima",
    s3: "Añadir",
    l1: "Un párrafo largo x ".repeat(4),
    l2: "Otro párrafo largo y ".repeat(4),
    l3: "Otro más largo z ".repeat(4),
  };
  const probe = {
    s1: "Finalizar",
    s2: "Parte superior",
    s3: "Agregar",
    l1: "Texto totalmente distinto aquí ".repeat(4),
    l2: "Nada en común con antes ".repeat(4),
    l3: "Completamente diferente otra vez ".repeat(4),
  };
  const picked = new Set(rankSuspects({ sourceFlat: source, targetFlat: target, probeFlat: probe, topN: 3, bandCount: 3 }).map((f) => f.key));
  expect([...picked].some((k) => k.startsWith("s")), "short strings must not lose every slot").toBe(true);
});

test("top_n_bounds_the_list_and_zero_means_none", () => {
  const source = Object.fromEntries([...Array(10).keys()].map((i) => [`k${i}`, `word ${i}`]));
  const target = Object.fromEntries([...Array(10).keys()].map((i) => [`k${i}`, `palabra ${i}`]));
  const probe = Object.fromEntries([...Array(10).keys()].map((i) => [`k${i}`, `término ${i}`]));
  expect(rankSuspects({ sourceFlat: source, targetFlat: target, probeFlat: probe, topN: 4 }).length).toBe(4);
  expect(rankSuspects({ sourceFlat: source, targetFlat: target, probeFlat: probe, topN: 0 })).toEqual([]);
});

test("a_key_missing_from_either_side_is_skipped_not_crashed", () => {
  const findings = rankSuspects({
    sourceFlat: { a: "Delete", b: "Save" },
    targetFlat: { a: "Borrar" },
    probeFlat: { a: "Eliminar" },
  });
  expect(findings.map((f) => f.key)).toEqual(["a"]);
});
