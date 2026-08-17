import { test } from "node:test"
import assert from "node:assert/strict"
import { isThemePreference, resolveColorScheme } from "./theme-preference.ts"

test("explicit preferences force their scheme", () => {
  assert.equal(resolveColorScheme("light"), "light")
  assert.equal(resolveColorScheme("dark"), "dark")
})

test("system clears the override so the OS decides", () => {
  assert.equal(resolveColorScheme("system"), null)
})

// Stored settings from an older build may carry anything; garbage must fall
// back to following the OS, never crash or force a scheme.
test("unrecognised stored values behave like system", () => {
  assert.equal(resolveColorScheme(undefined), null)
  assert.equal(resolveColorScheme("blue"), null)
  assert.equal(resolveColorScheme(42), null)
})

test("the guard accepts exactly the three preferences", () => {
  assert.equal(isThemePreference("system"), true)
  assert.equal(isThemePreference("light"), true)
  assert.equal(isThemePreference("dark"), true)
  assert.equal(isThemePreference("auto"), false)
  assert.equal(isThemePreference(null), false)
})
