// Data-only registry for the port runner. Keep profile construction here so
// port-test-runner.mjs stays focused on phases, assertions and diagnostics.
// `assertion` selects the completion protocol; `wrapper` selects the FFI shim.
// Profile data only: runner phases live in port-test-runner.mjs.
const awaited = (directory, wrapper, checks) => ({
  directory, wrapper, ffi: wrapper, checks, main: "Test.PortRunner", completion: "awaited",
  assertion: "ok", profile: "port-suite", sources: [["test", "src"]], exclude: ["Bench.purs"],
  javacArgs: [], javaArgs: ["-Xss8m"],
});
const synchronous = directory => ({
  directory, main: "Test.Main", completion: "synchronous", template: "spago.java.yaml",
  profile: "fixture", sources: [["src", "src"], ["test", "test"]], exclude: [],
  javacArgs: [], javaArgs: ["-Xss8m"],
});
const spec = (directory, checks) => ({
  ...synchronous(directory), main: "Test.PortRunner", wrapper: "Spec", ffi: "Aff", completion: "awaited",
  assertion: "spec", checks,
});
const wrappedSynchronous = (directory, wrapper) => ({
  ...synchronous(directory), main: "Test.PortRunner", wrapper, ffi: "Aff",
});
const specFull = directory => ({
  ...spec(directory, 70), wrapper: "SpecFull", timeout: 600000,
  javaArgs: ["-Djavapurs.test.timeout=600000"],
  sources: [["src", "src"], ["test", "test"], ["integration-tests", "integration-tests"]],
});
const unsupported = (directory, reason) => ({ ...synchronous(directory), completion: "unsupported", reason });

export const portSuites = {
  aff: awaited("javapurs-aff", "Aff", 45),
  promise: awaited("javapurs-js-promise", "Promise", 13),
  "promise-aff": awaited("javapurs-js-promise-aff", "Aff", 7),
  arrays: synchronous("javapurs-arrays"),
  assert: synchronous("javapurs-assert"),
  avar: synchronous("javapurs-avar"),
  "catenable-lists": synchronous("javapurs-catenable-lists"),
  console: synchronous("javapurs-console"),
  datetime: synchronous("javapurs-datetime"),
  effect: synchronous("javapurs-effect"),
  enums: synchronous("javapurs-enums"),
  "foldable-traversable": synchronous("javapurs-foldable-traversable"),
  foreign: synchronous("javapurs-foreign"),
  "foreign-object": synchronous("javapurs-foreign-object"),
  free: synchronous("javapurs-free"),
  functions: synchronous("javapurs-functions"),
  integers: synchronous("javapurs-integers"),
  "js-date": synchronous("javapurs-js-date"),
  lazy: synchronous("javapurs-lazy"),
  "node-buffer": synchronous("javapurs-node-buffer"),
  "node-event-emitter": spec("javapurs-node-event-emitter", 19),
  "node-fs": wrappedSynchronous("javapurs-node-fs", "Fs"),
  "node-http": wrappedSynchronous("javapurs-node-http", "Http"),
  "node-net": wrappedSynchronous("javapurs-node-net", "Net"),
  "node-path": synchronous("javapurs-node-path"),
  "node-process": synchronous("javapurs-node-process"),
  "node-streams": synchronous("javapurs-node-streams"),
  now: synchronous("javapurs-now"),
  nullable: synchronous("javapurs-nullable"),
  numbers: synchronous("javapurs-numbers"),
  "ordered-collections": synchronous("javapurs-ordered-collections"),
  partial: synchronous("javapurs-partial"),
  prelude: synchronous("javapurs-prelude"),
  quickcheck: synchronous("javapurs-quickcheck"),
  random: synchronous("javapurs-random"),
  record: synchronous("javapurs-record"),
  refs: synchronous("javapurs-refs"),
  exceptions: synchronous("javapurs-exceptions"),
  run: synchronous("javapurs-run"),
  spec: specFull("javapurs-spec"),
  st: synchronous("javapurs-st"),
  strings: { ...synchronous("javapurs-strings"), javacArgs: ["-J-Xss64m"], javaArgs: ["-Xss64m"] },
  "strings-extra": synchronous("javapurs-strings-extra"),
  unfoldable: synchronous("javapurs-unfoldable"),
  "unsafe-coerce": synchronous("javapurs-unsafe-coerce"),
  uuid: spec("javapurs-uuid", 6),
  variant: synchronous("javapurs-variant"),
  "yoga-json": spec("javapurs-yoga-json", 52),
};
