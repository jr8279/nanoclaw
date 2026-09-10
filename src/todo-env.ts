/**
 * Host-side env forwarding for the Todo MCP tool. Returns the Docker `-e`
 * arguments that pass the host's todo-app configuration into the container.
 *
 * TODO_API_URL is the base URL of the nanoclaw-todo app (github.com/jr8279/todo-list,
 * a standalone repo/deployment — nanoclaw only talks to it over HTTP); its
 * presence is also what gates registering the MCP server in the container
 * (see container/agent-runner/src/index.ts). TODO_API_KEY is forwarded only
 * if the todo app is running with a key configured.
 *
 * Lives in its own file so the reach-in in `container-runner.ts` is a single
 * call (`args.push(...todoEnvArgs())`) and this logic is behavior-testable in
 * isolation, without invoking the OneCLI-entangled `buildContainerArgs`.
 */
export function todoEnvArgs(): string[] {
  const args: string[] = [];
  if (process.env.TODO_API_URL) {
    args.push('-e', `TODO_API_URL=${process.env.TODO_API_URL}`);
  }
  if (process.env.TODO_API_KEY) {
    args.push('-e', `TODO_API_KEY=${process.env.TODO_API_KEY}`);
  }
  return args;
}
