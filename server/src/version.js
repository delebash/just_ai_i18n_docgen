// SPDX-License-Identifier: MIT
// Single source of truth for version + product strings (the family shape). The port of
// version.py.

import { readPackageVersion } from "@delebash/core/platform";

export const PRODUCT = "Just AI i18n & DocGen"; // one casing everywhere (docs sweep 2026-08-05)
// the server package's version — kept equal to the app's package.json (the family guard checks)
export const VERSION = readPackageVersion(import.meta.url);
export const API_VERSION = "v1";
export const DEFAULT_PORT = 8742; // JW 17495 · JV 17494
