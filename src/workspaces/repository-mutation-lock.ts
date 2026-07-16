export interface RepositoryMutationLock {
  runExclusive<T>(
    repositoryKey: string,
    operation: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T>;
}

interface LockWaiter {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface LockState {
  locked: boolean;
  waiters: LockWaiter[];
}

function createAbortError(): Error {
  const error = new Error("Repository mutation lock wait was aborted");
  error.name = "AbortError";
  return error;
}

/**
 * Serializes mutations by Git common-dir while leaving unrelated repositories
 * independent. The lock is process-local; cross-process safety is still left to
 * Git's own administrative locks.
 */
export class InProcessRepositoryMutationLock implements RepositoryMutationLock {
  private readonly states = new Map<string, LockState>();

  async runExclusive<T>(
    repositoryKey: string,
    operation: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    const release = await this.acquire(repositoryKey, signal);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private acquire(repositoryKey: string, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(createAbortError());
    }

    let state = this.states.get(repositoryKey);
    if (!state) {
      state = { locked: false, waiters: [] };
      this.states.set(repositoryKey, state);
    }

    if (!state.locked) {
      state.locked = true;
      return Promise.resolve(this.createRelease(repositoryKey, state));
    }

    return new Promise((resolve, reject) => {
      const waiter: LockWaiter = { resolve, reject };
      if (signal) {
        waiter.signal = signal;
        waiter.onAbort = () => {
          const index = state.waiters.indexOf(waiter);
          if (index >= 0) {
            state.waiters.splice(index, 1);
          }
          signal.removeEventListener("abort", waiter.onAbort!);
          reject(createAbortError());
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      state.waiters.push(waiter);
    });
  }

  private createRelease(repositoryKey: string, state: LockState): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;

      while (state.waiters.length > 0) {
        const waiter = state.waiters.shift()!;
        if (waiter.onAbort && waiter.signal) {
          waiter.signal.removeEventListener("abort", waiter.onAbort);
        }
        if (waiter.signal?.aborted) {
          waiter.reject(createAbortError());
          continue;
        }
        waiter.resolve(this.createRelease(repositoryKey, state));
        return;
      }

      state.locked = false;
      if (this.states.get(repositoryKey) === state) {
        this.states.delete(repositoryKey);
      }
    };
  }
}

export const defaultRepositoryMutationLock = new InProcessRepositoryMutationLock();
