// A conservative guard for the immutable inputs of transitiveCollect's cache.
export const sameIdentity = a => b => Object.is(a, b);
