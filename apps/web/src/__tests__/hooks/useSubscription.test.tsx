import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock socket.io-client
const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  connected: true,
};

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => mockSocket),
}));

// Mock the QuickdrawProvider context
const mockSocketContext = {
  socket: mockSocket,
  isConnected: true,
  userId: "test-user-id",
  serviceAccess: {},
  connect: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock("@fitzzero/quickdraw-core/client", async () => {
  const actual = await vi.importActual("@fitzzero/quickdraw-core/client");
  return {
    ...actual,
    useQuickdrawSocket: () => mockSocketContext,
  };
});

import { useSubscription } from "../../hooks";

describe("useSubscription deduplication", () => {
  let queryClient: QueryClient;

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
    
    // Setup mock emit to respond with success
    mockSocket.emit.mockImplementation(
      (event: string, payload: unknown, callback?: (response: unknown) => void) => {
        if (event.includes(":subscribe") && callback) {
          callback({
            success: true,
            data: {
              id: "user-123",
              name: "Test User",
              email: "test@example.com",
              image: null,
              serviceAccess: null,
            },
          });
        }
      }
    );
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("should share subscription across multiple hook instances", async () => {
    const entryId = "user-123";
    const serviceName = "userService";

    // Render first hook
    const { result: result1 } = renderHook(
      () => useSubscription(serviceName, entryId),
      { wrapper }
    );

    // Wait for subscription
    await waitFor(() => {
      expect(result1.current.isSubscribed).toBe(true);
    });

    // First hook should have called emit once
    expect(mockSocket.emit).toHaveBeenCalledTimes(1);
    expect(mockSocket.emit).toHaveBeenCalledWith(
      `${serviceName}:subscribe`,
      { entryId, requiredLevel: "Read" },
      expect.any(Function)
    );

    // Render second hook with same parameters
    const { result: result2 } = renderHook(
      () => useSubscription(serviceName, entryId),
      { wrapper }
    );

    // Second hook should NOT trigger another socket emit (deduplication)
    // Note: Due to quickdraw-core's deduplication, it increments refCount
    // instead of making a new subscription
    await waitFor(() => {
      expect(result2.current.data).toBeDefined();
    });

    // Both hooks should have the same data
    expect(result1.current.data).toEqual(result2.current.data);
  });

  it("should only unsubscribe when all instances unmount", async () => {
    const entryId = "user-456";
    const serviceName = "userService";

    // Render first hook
    const { result: result1, unmount: unmount1 } = renderHook(
      () => useSubscription(serviceName, entryId),
      { wrapper }
    );

    await waitFor(() => {
      expect(result1.current.isSubscribed).toBe(true);
    });

    // Render second hook
    const { result: result2, unmount: unmount2 } = renderHook(
      () => useSubscription(serviceName, entryId),
      { wrapper }
    );

    await waitFor(() => {
      expect(result2.current.data).toBeDefined();
    });

    // Unmount first hook - should NOT unsubscribe yet
    unmount1();

    // Socket off should not have been called for the update event
    // (or at least unsubscribe event should not have been emitted)
    const unsubscribeCalls = (mockSocket.emit.mock.calls as unknown[][]).filter(
      (call) => call[0] === `${serviceName}:unsubscribe`
    );
    expect(unsubscribeCalls.length).toBe(0);

    // Unmount second hook - NOW it should unsubscribe
    unmount2();

    // After all instances unmount, cleanup should occur
    await waitFor(() => {
      const finalUnsubscribeCalls = (mockSocket.emit.mock.calls as unknown[][]).filter(
        (call) => call[0] === `${serviceName}:unsubscribe`
      );
      expect(finalUnsubscribeCalls.length).toBe(1);
    });
  });

  it("should receive updates in all subscribed instances", async () => {
    const entryId = "user-789";
    const serviceName = "userService";
    const onData1 = vi.fn();
    const onData2 = vi.fn();

    // Capture the update handler
    let updateHandler: ((data: unknown) => void) | null = null;
    mockSocket.on.mockImplementation((event: string, handler: (data: unknown) => void) => {
      if (event === `${serviceName}:update:${entryId}`) {
        updateHandler = handler;
      }
    });

    // Render both hooks
    const { result: result1 } = renderHook(
      () => useSubscription(serviceName, entryId, { onData: onData1 }),
      { wrapper }
    );

    const { result: result2 } = renderHook(
      () => useSubscription(serviceName, entryId, { onData: onData2 }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result1.current.isSubscribed).toBe(true);
    });

    // Simulate an update from the server
    const updatedUser = {
      id: "user-789",
      name: "Updated Name",
      email: "test@example.com",
      image: "https://example.com/avatar.png",
    };

    if (updateHandler) {
      act(() => {
        updateHandler(updatedUser);
      });
    }

    // Both hooks should receive the update via TanStack Query cache
    await waitFor(() => {
      expect(result1.current.data?.name).toBe("Updated Name");
      expect(result2.current.data?.name).toBe("Updated Name");
    });
  });
});
