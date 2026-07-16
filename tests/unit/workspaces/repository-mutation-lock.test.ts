import { describe, expect, it } from "vitest";
import { InProcessRepositoryMutationLock } from "../../../src/workspaces/index.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe("InProcessRepositoryMutationLock", () => {
  it("serializes operations for the same Git common-dir", async () => {
    const lock = new InProcessRepositoryMutationLock();
    const firstMayFinish = deferred();
    const firstStarted = deferred();
    let active = 0;
    let maximumActive = 0;

    const first = lock.runExclusive("repo-a", async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      firstStarted.resolve();
      await firstMayFinish.promise;
      active -= 1;
    });
    await firstStarted.promise;
    const second = lock.runExclusive("repo-a", async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      active -= 1;
    });

    await Promise.resolve();
    expect(maximumActive).toBe(1);
    firstMayFinish.resolve();
    await Promise.all([first, second]);
    expect(maximumActive).toBe(1);
  });

  it("allows operations for different repositories to overlap", async () => {
    const lock = new InProcessRepositoryMutationLock();
    const bothStarted = deferred();
    const mayFinish = deferred();
    let active = 0;
    let maximumActive = 0;

    const operation = async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (active === 2) {
        bothStarted.resolve();
      }
      await mayFinish.promise;
      active -= 1;
    };
    const first = lock.runExclusive("repo-a", operation);
    const second = lock.runExclusive("repo-b", operation);

    await bothStarted.promise;
    expect(maximumActive).toBe(2);
    mayFinish.resolve();
    await Promise.all([first, second]);
  });

  it("removes an aborted waiter without blocking the next operation", async () => {
    const lock = new InProcessRepositoryMutationLock();
    const firstMayFinish = deferred();
    const firstStarted = deferred();
    const first = lock.runExclusive("repo-a", async () => {
      firstStarted.resolve();
      await firstMayFinish.promise;
    });
    await firstStarted.promise;

    const controller = new AbortController();
    const aborted = lock.runExclusive("repo-a", async () => undefined, controller.signal);
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });

    firstMayFinish.resolve();
    await first;
    await expect(lock.runExclusive("repo-a", async () => "ok")).resolves.toBe("ok");
  });
});
