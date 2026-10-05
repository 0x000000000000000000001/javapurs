// The native Rust lane borrows and compares without copying. JS keeps the
// PureScript oracle authoritative: these helpers only apply it in order.
export const compareQualifiedIdentImpl = reference => a => b => reference(a)(b);
export const eqQualifiedIdentImpl = reference => a => b => reference(a)(b);
