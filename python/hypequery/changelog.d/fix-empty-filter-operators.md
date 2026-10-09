- Fix deployment contracts that widened a filter declared with an empty `operators`
  allow-list to every operator. The empty list now reaches protocol validation and is
  rejected, matching TypeScript, so a deployment can no longer accept filters the local
  planner refuses.
