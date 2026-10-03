// Frontend declarations for the JVM-only process boundary.
export const mode = () => "suite";
export const awaitAff = _ => () => { throw new Error("JVM test entrypoint"); };
export const awaitPromise = _ => () => { throw new Error("JVM test entrypoint"); };
