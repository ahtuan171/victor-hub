import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { parse } from "yaml";

import { DESTINATION_STATUSES, THEMES, TRIP_STATUSES } from "../../lib/api";

/**
 * `lib/api.ts` is hand-written from the contract, so this is what stops it drifting from one.
 *
 * The project installs no OpenAPI codegen — eight operations and four schemas is smaller than the
 * toolchain that would generate them (research.md R-007's "a typed fetch wrapper is enough").
 * Hand-written types buy simplicity and owe exactly one thing in return: a test that fails when the
 * contract gains a status, a platform, or an invariant code and the client does not.
 *
 * Only the closed enums are checked. Object shapes are not, because a TypeScript interface has no
 * runtime representation to compare — `tsc --noEmit` in the CI review stage is what holds those,
 * and the enums are the part that would otherwise silently accept an unknown value at runtime.
 */

// The 002 contract is a delta on 001, not a second API (see its own header comment) — Theme lives
// only here.
const CONTRACT_002 = resolve(__dirname, "../../../specs/002-pixel-arcade-skin/contracts/openapi.yaml");
// 003, unlike 002, is a new standalone resource space rather than a delta (its own header comment)
// — DestinationStatus and TripStatus live only here.
const CONTRACT_003 = resolve(__dirname, "../../../specs/003-travel-map/contracts/openapi.yaml");

function schemasIn(contractPath: string): Record<string, unknown> {
  const document: unknown = parse(readFileSync(contractPath, "utf8"));
  const schemas = (document as { components?: { schemas?: Record<string, unknown> } }).components?.schemas;
  expect(schemas, `no components.schemas in ${contractPath}`).toBeTruthy();
  return schemas as Record<string, unknown>;
}

function contractEnum(schema: string, contractPath: string): string[] {
  const target = schemasIn(contractPath)[schema];
  expect(target, `no components.schemas.${schema} in ${contractPath}`).toBeTruthy();

  const values = (target as { enum?: unknown }).enum;
  expect(Array.isArray(values), `components.schemas.${schema} declares no enum`).toBe(true);

  return values as string[];
}

test("Theme matches the 002 contract — FR-010's two presentations, dark first", () => {
  expect([...THEMES]).toEqual(contractEnum("Theme", CONTRACT_002));
});

test("DestinationStatus matches the 003 contract — FR-002/FR-026's map-pin states", () => {
  expect([...DESTINATION_STATUSES]).toEqual(contractEnum("DestinationStatus", CONTRACT_003));
});

test("TripStatus matches the 003 contract — FR-014's descriptive six", () => {
  expect([...TRIP_STATUSES]).toEqual(contractEnum("TripStatus", CONTRACT_003));
});
