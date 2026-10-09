// SPDX-License-Identifier: MIT
// This app's Settings sections, in render order — ONE list the view renders and
// the contract test asserts (parity batch slice 11). The family sections must keep
// the canon RELATIVE order (kit familyContract SETTINGS_SECTION_ORDER); Reviewer is
// app-own (tool identity — no family equivalent) and interleaves before About.
export const SETTINGS_SECTION_IDS = [
  "appearance",
  "backups",
  "storage",
  "server",
  "logs",
  "updates",
  "reviewer",
  "about",
];
