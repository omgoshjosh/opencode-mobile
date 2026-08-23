import { test } from "node:test"
import assert from "node:assert/strict"
import { availableZones, filterZones, zoneDisplayLabel, FALLBACK_ZONES } from "./zone-list.ts"
import { isValidZone } from "./timestamp-shorthand.ts"

test("every curated fallback zone is a real zone this runtime can render", () => {
  const invalid = FALLBACK_ZONES.filter((zone) => !isValidZone(zone))
  assert.deepEqual(invalid, [])
})

test("availableZones returns a non-empty list", () => {
  assert.ok(availableZones().length >= FALLBACK_ZONES.length)
})

test("display label puts the city first and strips underscores", () => {
  assert.equal(zoneDisplayLabel("America/Los_Angeles"), "Los Angeles · America")
  assert.equal(zoneDisplayLabel("UTC"), "UTC")
  assert.equal(zoneDisplayLabel("America/Argentina/Buenos_Aires"), "Buenos Aires · America")
})

test("search matches raw names and display forms, case-insensitively", () => {
  const zones = ["America/Los_Angeles", "Europe/Berlin", "Asia/Tokyo"]
  assert.deepEqual(filterZones(zones, "los angeles"), ["America/Los_Angeles"])
  assert.deepEqual(filterZones(zones, "BERLIN"), ["Europe/Berlin"])
  assert.deepEqual(filterZones(zones, "asia/"), ["Asia/Tokyo"])
  assert.deepEqual(filterZones(zones, ""), zones)
  assert.deepEqual(filterZones(zones, "atlantis"), [])
})
