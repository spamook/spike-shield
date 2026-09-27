// Page states for the rush tester (contract in team-plan.md). It reads <body data-state>:
//   loading: the app is starting or waiting for the feed
//   ready:   the feed rendered with data
//   error:   a Supabase call failed and the app shows an error
// index.html starts at "loading"; the pages update it.
export type PageState = "loading" | "ready" | "error";

export function setPageState(state: PageState) {
  document.body.dataset.state = state;
}
