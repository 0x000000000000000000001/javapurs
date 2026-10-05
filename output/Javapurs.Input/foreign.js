// Retain PBO's existing bounded read setting and fallback. Batch traversal in
// Input.purs preserves the directory order, regardless of read completion order.
export const readConcurrency = () => {
  const configured = process.env.GOPURS_JOBS ?? "";
  const jobs = Number(configured);
  return /^\d+$/.test(configured) && jobs >= 1 && jobs <= 64 ? jobs : 1;
};
