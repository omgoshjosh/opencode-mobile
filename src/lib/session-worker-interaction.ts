/** Expand only invokes child loading; root navigation remains a separate tap target. */
export function expandWorkers(expanded: boolean, loadChildren: () => void): boolean {
  if (!expanded) loadChildren()
  return !expanded
}
