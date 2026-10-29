// SPDX-License-Identifier: MIT
// The review workspace's request schemas (app-structure §15) — what every /v1 project route takes, checked by the
// kit's `input()` before a handler runs; Review's forms build their rules from the same objects (`schemaRules`,
// imported as `just-ai-i18n-docgen-server/schemas/workspace.js`). The limits a user meets live here, nowhere else.
// They are generous on purpose: the biggest real catalog (JustWrite's, 2026-10-29) holds 3,165 keys, its longest
// string 569 characters and its longest key 66. Browser-safe: this file imports only the kit's `platform/schema`.

import { literal, nullable, opt, strictObject, T } from "@delebash/core/platform/schema";

/** A language tag (BCP 47 — `es`, `pt-BR`, `zh-Hant-TW`). */
export const LANG_MAX = 35;
/** A dotted catalog key. */
export const KEY_MAX = 500;
/** A translation, a reviewer's note, a run's context sentence. */
export const TEXT_MAX = 10000;
/** The keys one click may name — every key of a catalog. */
export const KEYS_MAX = 50000;
/** An id: an engine preset's, a finding's code, an AI action's name. */
export const ID_MAX = 200;

/** The only scopes a run may have. Anything else is a typo, and a typo must not start a job — found by driving the
 *  real catalogue: an unrecognised scope fell through to the flagged branch and started a 154-key run. `pending` is
 *  the dashboard's button: keys with no translation at all PLUS flagged ones. */
export const SCOPES = ["flagged", "unsure", "all", "keys", "pending"];

export const Lang = T.String({ minLength: 1, maxLength: LANG_MAX });
export const Key = T.String({ minLength: 1, maxLength: KEY_MAX });
export const Text = T.String({ maxLength: TEXT_MAX });
export const Id = T.String({ minLength: 1, maxLength: ID_MAX });
const Keys = T.Array(Key, { maxItems: KEYS_MAX });

/** POST /v1/save — a translation typed in Review. */
export const SaveIn = strictObject({ lang: Lang, key: Key, value: Text });

/** POST /v1/accept — one key or many (one undo either way). */
export const AcceptIn = strictObject({ lang: Lang, key: opt(Key), keys: opt(Keys) });

/** DELETE /v1/accept — a key's acceptances, or only one finding's. */
export const UnacceptIn = strictObject({ lang: Lang, key: Key, code: opt(nullable(Id)) });

/** POST /v1/undo — this language's last action (none named: the last in any language). */
export const UndoIn = strictObject({ lang: opt(nullable(Lang)) });

/** POST /v1/proposals/apply — the staged values to write. */
export const ApplyIn = strictObject({ lang: Lang, keys: Keys });

/** DELETE /v1/proposals — the staged values to drop (no keys: all of the language's). */
export const DiscardIn = strictObject({ lang: Lang, keys: opt(nullable(Keys)) });

/** PUT /v1/notes — a reviewer's note on a key (empty or none: the note goes). */
export const NoteIn = strictObject({ lang: Lang, key: Key, note: opt(nullable(Text)) });

/** POST /v1/backtranslate — the translation read back into the source language. */
export const BacktranslateIn = strictObject({ lang: Lang, key: Key });

/** POST /v1/jobs — a translation run. */
export const RunIn = strictObject({
  lang: Lang,
  scope: opt(literal(...SCOPES), "flagged"),
  keys: opt(nullable(Keys)),
  presetId: opt(nullable(Id)),
});

const optLang = () => T.Optional(Lang);

/** The query strings. */
export const LangQuery = T.Object({ lang: optLang() });
export const TestVariablesQuery = T.Object({ action: Id, lang: Lang });
export const ProposalsQuery = T.Object({ lang: optLang(), key: T.Optional(Key) });
export const SiblingsQuery = T.Object({ key: Key, lang: optLang() });
// key or term — neither (or both empty) is the route's own refusal, in words
export const TermsQuery = T.Object({
  lang: optLang(),
  key: T.Optional(T.String({ maxLength: KEY_MAX })),
  term: T.Optional(T.String({ maxLength: KEY_MAX })),
});
export const ReferenceQuery = T.Object({ key: Key, lang: optLang(), engine: T.Optional(T.String({ minLength: 1, maxLength: ID_MAX, default: "backtranslate" })) });
export const GtFrameQuery = T.Object({
  text: T.Optional(T.String({ maxLength: TEXT_MAX, default: "" })),
  tl: T.Optional(T.String({ minLength: 1, maxLength: LANG_MAX, default: "es" })),
});
