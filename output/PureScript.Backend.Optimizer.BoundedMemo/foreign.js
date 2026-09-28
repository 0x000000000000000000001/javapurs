// Private cache for immutable compiler inputs. Map uses object identity.
export const createBoundedMemo = capacity => f => () => {
  if (capacity <= 0) return a => b => f(a, b);
  let entries;
  let fifo;
  let next = 0;
  let count = 0;
  return a => b => {
    const inner = entries?.get(a);
    if (inner?.has(b)) return inner.get(b);
    const result = f(a, b);
    // A nested call may already have installed the same immutable result.
    const current = entries?.get(a);
    if (current?.has(b)) return current.get(b);
    if (!entries) {
      entries = new Map();
      fifo = new Array(capacity);
    }
    if (count === capacity) {
      const [oldA, oldB] = fifo[next];
      const oldInner = entries.get(oldA);
      oldInner.delete(oldB);
      if (oldInner.size === 0) entries.delete(oldA);
    } else {
      count++;
    }
    fifo[next] = [a, b];
    next = (next + 1) % capacity;
    let destination = entries.get(a);
    if (!destination) entries.set(a, destination = new Map());
    destination.set(b, result);
    return result;
  };
};

export const createStringMemo = createBoundedMemo;
