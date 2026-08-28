// A tool-run may only render the global transcript after its route owner wins
// selection; otherwise a stacked child session can masquerade as an empty run.
export function ownsToolRunTranscript(ownerSessionID?: string, currentSessionID?: string): boolean {
  return !!ownerSessionID && ownerSessionID === currentSessionID
}
