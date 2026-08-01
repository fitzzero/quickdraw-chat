/** Browser-context globals referenced inside page.evaluate callbacks. */
interface Window {
  QuickdrawBench?: {
    batches: unknown[];
    push: (json: string) => void;
    drain: () => unknown[];
  };
}
