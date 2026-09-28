// The Go backend provides a native decoder; JavaScript keeps the validated
// PureScript algorithm (same result, no behavioural change).
import * as TypeTable from "../PureScript.Backend.Optimizer.CoreFn.TypeTable/index.js";

// This checks the JSON number before any conversion to a 32-bit PureScript Int.
export const isNonNegativeInteger = value => Number.isInteger(value) && value >= 0;

export const decodeTypeTableImpl = typeTableJson => TypeTable.decodeTypeTablePS(typeTableJson);

// JavaScript calls the PureScript loop supplied by the caller; the Go backend
// implements the same loop natively.
export const decodeArrayImpl = fallback => decoder => arr => fallback(decoder)(arr);

// JavaScript calls the PureScript annotation decoder supplied by the caller;
// the Go backend decodes annotations natively.
export const decodeAnnWithUsageImpl = fallback => moduleName => typeTable => path => json =>
  fallback(moduleName)(typeTable)(path)(json);

// JavaScript calls the PureScript module decoder supplied by the caller; the
// Go backend decodes the whole module natively and validates natively.
export const decodeModuleImpl = fallback => validate => json => fallback(json);
