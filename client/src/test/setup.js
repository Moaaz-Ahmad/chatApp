import "@testing-library/jest-dom";

// jsdom does not implement scrollIntoView — stub it so MessageList's
// useLayoutEffect / useEffect calls don't throw "not a function".
Element.prototype.scrollIntoView = vi.fn();

// jsdom always returns 0 for scrollHeight/scrollTop; these stubs keep
// the MessageList scroll-position logic from throwing.
Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
  configurable: true,
  get() { return 0; },
});
