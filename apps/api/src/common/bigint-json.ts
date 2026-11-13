/**
 * JSON has no bigint. Money crosses the wire as a string of digits
 * ("4500000") and is turned back into a bigint with parseRwf from @kora/core.
 * It is never sent as a JSON number, which would be a float on the other side.
 */
export function installBigIntJson(): void {
  const proto = BigInt.prototype as unknown as { toJSON?: () => string };
  if (!proto.toJSON) {
    proto.toJSON = function toJSON(this: bigint) {
      return this.toString();
    };
  }
}
