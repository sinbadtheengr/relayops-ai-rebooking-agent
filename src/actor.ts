import { AsyncLocalStorage } from "node:async_hooks";
import { userInfo } from "node:os";

const context = new AsyncLocalStorage<string>();

export function asActor<T>(actor: string, work: () => T): T {
  return context.run(actor, work);
}

export function actorId(): string {
  return context.getStore() ?? `operator:${userInfo().username}`;
}

export function requireStaff() {
  if (!/^(slack|operator):.+/.test(actorId())) throw new Error("A staff member must perform this action.");
}
