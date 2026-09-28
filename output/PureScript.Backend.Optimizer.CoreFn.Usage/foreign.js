// JavaScript calls the PureScript implementation supplied by the caller; the
// Go backend implements the same validation natively.
export const validateSourceUsageModuleImpl = fallback => mod => fallback(mod);
