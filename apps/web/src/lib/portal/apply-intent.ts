/**
 * "Apply" for one product on the website: the product is kept for this tab
 * until the borrower reaches the application form, through sign-in if needed.
 */
const KEY = 'kl_apply_product';

export function rememberApplyProduct(code: string): void {
  try {
    sessionStorage.setItem(KEY, code);
  } catch {
    // storage blocked: the borrower picks the product on the form
  }
}

export function pendingApplyProduct(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Read it once, on the form. */
export function takeApplyProduct(): string | null {
  const code = pendingApplyProduct();
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
  return code;
}
