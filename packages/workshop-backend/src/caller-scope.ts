// Family Memory Book fork (docs/UPSTREAM.md): per-user identity for gadget server code.
//
// Every collaborator's connectToGadget() returns a stub to the same gadget Durable Object, with no
// caller identity attached anywhere in the dispatch path -- so a gadget cannot enforce per-user
// roles on its own. For gadgets flagged `callerAware` (GadgetRecord.callerAware, set only by the
// Workshop's own createBook, never by users or agents), connectToGadget() returns this proxy
// instead: an RpcTarget whose every method call forwards to the facet with a server-minted
// GadgetCaller prepended. The gadget declares its methods as `foo(caller, ...args)` and passes
// `caller.clerkUserId` to its FAMILY session's requireRole() before acting.
//
// Upstream gadgets are untouched: without the flag, connectToGadget() behaves exactly as before.

import { RpcStub, RpcTarget } from "capnweb";
import type { GadgetCaller } from "@gadgets/workshop-shared/api";

// Method names that must resolve on the proxy itself, never be forwarded: `then` so that awaiting
// the proxy (or returning it from an async function) does not treat it as a thenable, and anything
// RpcTarget/Object already define (constructor, toString, Symbol.dispose, ...).
function isOwnProperty(target: object, prop: string | symbol): boolean {
  return prop === "then" || prop in target;
}

/** A facet stub scoped to one caller: `proxy.method(a, b)` becomes `facet.method(caller, a, b)`. */
export function callerScopedFacet(facet: any, caller: GadgetCaller): RpcStub<any> {
  const target = new RpcTarget();
  const proxy = new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop !== "string" || isOwnProperty(t, prop)) {
        return Reflect.get(t, prop, receiver);
      }
      return (...args: unknown[]) => facet[prop](caller, ...args);
    },
  });
  return proxy as unknown as RpcStub<any>;
}
