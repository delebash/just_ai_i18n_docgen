// SPDX-License-Identifier: MIT
// Setup's and the reviewer's request schemas (app-structure §15) — checked by the kit's `input()` on /v1/setup/* and
// /v1/reviewer, and the same objects build Setup's and Settings → Reviewer's form rules (`schemaRules`, imported as
// `just-ai-i18n-docgen-server/schemas/setup.js`). Browser-safe: this file imports only the kit's `platform/schema`.

import { nullable, opt, strictObject, T } from "@delebash/core/platform/schema";
import { Lang, Text } from "./workspace.js";

/** A path the user pastes (Windows' own limit with long paths is 32,767; Linux's PATH_MAX is 4,096). */
export const PATH_MAX = 4096;
/** A do-not-translate term, and how many a glossary holds. */
export const TERM_MAX = 200;
export const GLOSSARY_MAX = 5000;
/** The languages one project translates into. */
export const TARGETS_MAX = 500;
/** The reviewer's name, written into every acceptance. */
export const REVIEWER_MAX = 200;

const Path = T.String({ minLength: 1, maxLength: PATH_MAX });

/** POST /v1/setup/inspect — the path box. */
export const InspectIn = strictObject({ path: Path });

/** POST /v1/setup/save — a field not sent (or null) keeps what the existing config has. */
export const SetupIn = strictObject({
  path: Path,
  targets: opt(nullable(T.Array(Lang, { maxItems: TARGETS_MAX }))),
  context: opt(nullable(Text)),
  glossary: opt(nullable(T.Array(T.String({ maxLength: TERM_MAX }), { maxItems: GLOSSARY_MAX }))),
});

/** One glossary term as Setup's add box takes it (the form's rules; the list rides SetupIn). Optional: the box sits
 *  inside Setup's form and is empty whenever nothing is being added — a required rule there refused every Save (the
 *  e2e's create-flow, 2026-10-29). */
export const TermIn = strictObject({ term: opt(T.String({ maxLength: TERM_MAX })) });

/** PUT /v1/reviewer — a name, or none. */
export const ReviewerIn = strictObject({ reviewer: nullable(T.String({ maxLength: REVIEWER_MAX })) });
