// Java-only fixture. Stubs satisfy purs's foreign-export validation.
export const awaitAff = _ => () => { throw new Error("Run this fixture with Javapurs"); };
export const newGate = () => null;
export const signal = _ => () => {};
export const wait = _ => () => {};
export const nativeError = new Error("native checked exception");
export const sameError = first => second => first === second;
export const causeIs = error => cause => error.cause === cause;
