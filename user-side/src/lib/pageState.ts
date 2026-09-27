// Sets <body data-state> so the rush tester can tell what a visitor sees (see "Page states" in
// fakeapp-scripts-work.md and team-plan.md). Call setPageState("loading") when a page starts
// loading, then "ready" once all of its Supabase calls have settled, or "error" if any failed.
export type PageState = "loading" | "ready" | "error";

export function setPageState(state: PageState): void {
  document.body.dataset.state = state;
}
