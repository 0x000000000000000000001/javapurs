// Java-only fixture. Stubs satisfy purs's foreign-export validation.
export const awaitAff = _ => () => { throw new Error("Run this fixture with Javapurs"); };
export const newGate = () => null;
export const signal = _ => () => {};
export const wait = _ => () => {};
