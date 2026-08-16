import { test } from "node:test"
import assert from "node:assert/strict"
import { COMPOSER_KEYBOARD_GAP_DP, IOS_KEYBOARD_VERTICAL_OFFSET, keyboardVerticalOffset } from "./keyboard-offset.ts"

test("iOS keeps its existing empirical offset regardless of inset", () => {
  assert.equal(keyboardVerticalOffset("ios", 0), IOS_KEYBOARD_VERTICAL_OFFSET)
  assert.equal(keyboardVerticalOffset("ios", 48.857), IOS_KEYBOARD_VERTICAL_OFFSET)
})

test("Android offsets by the status-bar inset plus a visible gap", () => {
  // 48.857 closes the coordinate-space shortfall; the gap keeps the composer
  // from sitting flush against the keyboard's top edge.
  assert.equal(keyboardVerticalOffset("android", 48.857), 48.857 + COMPOSER_KEYBOARD_GAP_DP)
})

test("Android with no status-bar inset still gets the gap", () => {
  assert.equal(keyboardVerticalOffset("android", 0), COMPOSER_KEYBOARD_GAP_DP)
})

test("a negative/bogus inset never pushes content down", () => {
  assert.equal(keyboardVerticalOffset("android", -20), COMPOSER_KEYBOARD_GAP_DP)
})

// Regression guard for the arithmetic the offset exists to fix.
test("offset makes computed padding equal the real keyboard height", () => {
  const windowBottom = 748.857 // frame.y + frame.height, window coords
  const keyboardScreenY = 511.714 // screen coords
  const keyboardHeight = 286
  const insetTop = 48.857

  const withoutFix = windowBottom - keyboardScreenY
  assert.ok(withoutFix < keyboardHeight, "precondition: unfixed padding is short")

  const offset = keyboardVerticalOffset("android", insetTop)
  const withFix = windowBottom - (keyboardScreenY - offset)
  // Clears the keyboard by exactly the intended gap — not short (composer
  // hidden), not arbitrary (a fudge factor).
  assert.ok(
    Math.abs(withFix - (keyboardHeight + COMPOSER_KEYBOARD_GAP_DP)) < 0.01,
    `expected ~${keyboardHeight + COMPOSER_KEYBOARD_GAP_DP}, got ${withFix}`,
  )
})

// Measured on a real Pixel 3 XL (notch + gesture navigation), which differs
// from the emulator the original fix was derived on.
test("real Pixel 3 XL geometry clears the keyboard with the intended gap", () => {
  const windowBottom = 748.857
  const keyboardScreenY = 509.4285583496094
  const keyboardHeight = 288.28570556640625
  const insetTop = 48.85714340209961

  const offset = keyboardVerticalOffset("android", insetTop)
  const padding = windowBottom - (keyboardScreenY - offset)
  assert.ok(
    Math.abs(padding - (keyboardHeight + COMPOSER_KEYBOARD_GAP_DP)) < 0.01,
    `expected ~${keyboardHeight + COMPOSER_KEYBOARD_GAP_DP}, got ${padding}`,
  )
})
