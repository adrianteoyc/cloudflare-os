import { describe, expect, it } from "vitest";
import { resolveOnboardingGate } from "./onboardingGate";

describe("resolveOnboardingGate", () => {
  it("routes an admin to upstream's wizard when it isn't completed yet", () => {
    expect(resolveOnboardingGate({
      isAdmin: true, upstreamOnboardingCompleted: false, needsCreateFamily: true,
    })).toBe("upstream-wizard");
  });

  it("routes an admin straight to the app once upstream's wizard is completed", () => {
    expect(resolveOnboardingGate({
      isAdmin: true, upstreamOnboardingCompleted: true, needsCreateFamily: true,
    })).toBe("app");
  });

  it("an admin is never routed to create-family, even with no family", () => {
    expect(resolveOnboardingGate({
      isAdmin: true, upstreamOnboardingCompleted: true, needsCreateFamily: true,
    })).not.toBe("create-family");
  });

  describe("admin without a family", () => {
    // Admins keep upstream's own onboarding untouched (requirements: "Admins ... still get
    // upstream onboarding"). needsCreateFamily is still reported truthfully to them (see
    // checkFamilyOnboarding() in packages/workshop-backend/src/server.ts) so UserMenu's manual
    // "Create your family" entry can show -- but the automatic *gate* must ignore it entirely for
    // an admin, exactly like it does when they DO have a family (the test above this describe
    // block). These two tests pin that down explicitly rather than leaving it implied.
    it("routes to upstream's wizard, not create-family, when it isn't completed", () => {
      expect(resolveOnboardingGate({
        isAdmin: true, upstreamOnboardingCompleted: false, needsCreateFamily: true,
      })).toBe("upstream-wizard");
    });

    it("routes to the app, not create-family, once upstream's wizard is completed", () => {
      expect(resolveOnboardingGate({
        isAdmin: true, upstreamOnboardingCompleted: true, needsCreateFamily: true,
      })).toBe("app");
    });

    it("routing is identical whether or not the admin has a family -- only upstreamOnboardingCompleted matters", () => {
      const withFamily = resolveOnboardingGate({
        isAdmin: true, upstreamOnboardingCompleted: true, needsCreateFamily: false,
      });
      const withoutFamily = resolveOnboardingGate({
        isAdmin: true, upstreamOnboardingCompleted: true, needsCreateFamily: true,
      });
      expect(withFamily).toBe(withoutFamily);
      expect(withFamily).toBe("app");
    });
  });

  it("routes a non-admin with no family to the create-family screen", () => {
    expect(resolveOnboardingGate({
      isAdmin: false, upstreamOnboardingCompleted: false, needsCreateFamily: true,
    })).toBe("create-family");
  });

  it("routes a non-admin who already has a family straight to the app, skipping both screens", () => {
    expect(resolveOnboardingGate({
      isAdmin: false, upstreamOnboardingCompleted: false, needsCreateFamily: false,
    })).toBe("app");
  });

  it("a non-admin's routing ignores upstreamOnboardingCompleted entirely -- only needsCreateFamily matters", () => {
    const withUpstreamDone = resolveOnboardingGate({
      isAdmin: false, upstreamOnboardingCompleted: true, needsCreateFamily: true,
    });
    const withUpstreamNotDone = resolveOnboardingGate({
      isAdmin: false, upstreamOnboardingCompleted: false, needsCreateFamily: true,
    });
    expect(withUpstreamDone).toBe(withUpstreamNotDone);
    expect(withUpstreamDone).toBe("create-family");
  });
});
