/**
 * The web build of the borrower app keeps its values in sessionStorage:
 * closing the tab signs the borrower out, which suits shared computers.
 */
function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export const storage = {
  get: async (key: string): Promise<string | null> => store()?.getItem(key) ?? null,
  set: async (key: string, value: string): Promise<void> => {
    store()?.setItem(key, value);
  },
  remove: async (key: string): Promise<void> => {
    store()?.removeItem(key);
  },
};
