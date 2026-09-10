import { describe, expect, it, vi } from "vitest";
import { RpcTarget } from "capnweb";
import type { GadgetCaller } from "@gadgets/workshop-shared/api";
import { callerScopedFacet } from "../src/caller-scope.js";

const caller: GadgetCaller = { userId: "grandma@example.com", clerkUserId: "user_1", workspaceRole: "use" };

describe("callerScopedFacet", () => {
  it("prepends the caller to every forwarded method call and returns the facet's result", async () => {
    const savePage = vi.fn<(...args: unknown[]) => Promise<string>>(async () => "saved");
    const proxy = callerScopedFacet({ savePage }, caller) as any;

    await expect(proxy.savePage(7, { title: "Cover" })).resolves.toBe("saved");

    expect(savePage).toHaveBeenCalledExactlyOnceWith(caller, 7, { title: "Cover" });
  });

  it("forwards arbitrary method names, so the gadget's whole API is reachable", async () => {
    const facet = { a: vi.fn(async () => 1), someOtherMethod: vi.fn(async () => 2) };
    const proxy = callerScopedFacet(facet, caller) as any;

    await proxy.a();
    await proxy.someOtherMethod("x");

    expect(facet.a).toHaveBeenCalledWith(caller);
    expect(facet.someOtherMethod).toHaveBeenCalledWith(caller, "x");
  });

  it("is a real RpcTarget (so capnweb serialises it by reference) and is not a thenable", async () => {
    const proxy = callerScopedFacet({}, caller) as any;

    expect(proxy).toBeInstanceOf(RpcTarget);
    // If `then` were forwarded, `await proxy` would call facet.then(caller, resolve, reject) and
    // never settle. It must simply resolve to the proxy itself.
    expect(proxy.then).toBeUndefined();
    await expect(Promise.resolve(proxy)).resolves.toBe(proxy);
  });

  it("does not let the client override the caller by passing its own", async () => {
    const savePage = vi.fn(async () => undefined);
    const proxy = callerScopedFacet({ savePage }, caller) as any;
    const forged: GadgetCaller = { userId: "attacker", clerkUserId: "user_evil", workspaceRole: "build" };

    await proxy.savePage(forged, 1);

    // The forged object is just an ordinary argument, after the server-minted caller.
    expect(savePage).toHaveBeenCalledExactlyOnceWith(caller, forged, 1);
  });
});
