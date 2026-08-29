import type { Part } from "./sdk"

export const TRUNCATION_NOTICE = "[Output truncated. Open full output to load the complete result.]"

export function isToolOutputTruncated(part: Part): boolean {
  return part.state?.metadata?.outputTruncated === true
}

export function stagedToolOutput(output: string, truncated: boolean): string {
  return truncated ? `${output}\n\n${TRUNCATION_NOTICE}` : output
}

export function matchingToolPart(parts: Part[], input: { partID?: string; callID?: string }): Part | undefined {
  const tools = parts.filter((part) => part.type === "tool")
  return tools.find((part) => part.id === input.partID) ?? tools.find((part) => input.callID != null && part.callID === input.callID)
}
