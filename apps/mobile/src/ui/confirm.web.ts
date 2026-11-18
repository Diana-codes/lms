/** The web build: the browser's own confirmation dialog. */
export function confirm(title: string, message: string, _ok: string, _cancel: string) {
  return Promise.resolve(window.confirm(`${title}\n\n${message}`));
}
