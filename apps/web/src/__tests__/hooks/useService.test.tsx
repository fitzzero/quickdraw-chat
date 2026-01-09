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

import { useService } from "../../hooks";

describe("useService", () => {
  let queryClient: QueryClient;

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("should call socket.emit with correct event name and payload", async () => {
    const onSuccess = vi.fn();
    const chatResponse = {
      id: "chat-1",
      title: "Test Chat",
      createdAt: new Date().toISOString(),
      ownerId: "test-user-id",
    };

    mockSocket.emit.mockImplementation(
      (event: string, payload: unknown, callback?: (response: unknown) => void) => {
        if (callback) {
          callback({ success: true, data: chatResponse });
        }
      }
    );

    const { result } = renderHook(
      () => useService("chatService", "createChat", { onSuccess }),
      { wrapper }
    );

    expect(result.current.isPending).toBe(false);

    act(() => {
      result.current.mutate({ title: "Test Chat" });
    });

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    expect(mockSocket.emit).toHaveBeenCalledWith(
      "chatService:createChat",
      { title: "Test Chat" },
      expect.any(Function)
    );

    expect(onSuccess).toHaveBeenCalledWith(chatResponse);
    expect(result.current.data).toEqual(chatResponse);
  });

  it("should handle errors correctly", async () => {
    const onError = vi.fn();
    const errorMessage = "Permission denied";

    mockSocket.emit.mockImplementation(
      (event: string, payload: unknown, callback?: (response: unknown) => void) => {
        if (callback) {
          callback({ success: false, error: errorMessage });
        }
      }
    );

    const { result } = renderHook(
      () => useService("chatService", "createChat", { onError }),
      { wrapper }
    );

    act(() => {
      result.current.mutate({ title: "Test Chat" });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(onError).toHaveBeenCalledWith(errorMessage);
    expect(result.current.error).toBe(errorMessage);
  });

  it("should return promise from mutateAsync", async () => {
    const chatResponse = {
      id: "chat-2",
      title: "Async Chat",
      createdAt: new Date().toISOString(),
      ownerId: "test-user-id",
    };

    mockSocket.emit.mockImplementation(
      (event: string, payload: unknown, callback?: (response: unknown) => void) => {
        if (callback) {
          callback({ success: true, data: chatResponse });
        }
      }
    );

    const { result } = renderHook(
      () => useService("chatService", "createChat"),
      { wrapper }
    );

    let resolvedData: unknown;
    await act(async () => {
      resolvedData = await result.current.mutateAsync({ title: "Async Chat" });
    });

    expect(resolvedData).toEqual(chatResponse);
  });

  it("should reject promise from mutateAsync on error", async () => {
    const errorMessage = "Server error";

    mockSocket.emit.mockImplementation(
      (event: string, payload: unknown, callback?: (response: unknown) => void) => {
        if (callback) {
          callback({ success: false, error: errorMessage });
        }
      }
    );

    const { result } = renderHook(
      () => useService("chatService", "createChat"),
      { wrapper }
    );

    await expect(
      act(async () => {
        await result.current.mutateAsync({ title: "Fail Chat" });
      })
    ).rejects.toThrow(errorMessage);
  });

  it("should reset state correctly", async () => {
    const chatResponse = {
      id: "chat-3",
      title: "Reset Test",
      createdAt: new Date().toISOString(),
      ownerId: "test-user-id",
    };

    mockSocket.emit.mockImplementation(
      (event: string, payload: unknown, callback?: (response: unknown) => void) => {
        if (callback) {
          callback({ success: true, data: chatResponse });
        }
      }
    );

    const { result } = renderHook(
      () => useService("chatService", "createChat"),
      { wrapper }
    );

    act(() => {
      result.current.mutate({ title: "Reset Test" });
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should handle missing socket gracefully", async () => {
    const originalSocket = mockSocketContext.socket;
    mockSocketContext.socket = null as unknown as typeof mockSocket;

    const { result } = renderHook(
      () => useService("chatService", "createChat"),
      { wrapper }
    );

    act(() => {
      result.current.mutate({ title: "No Socket" });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toContain("Socket not connected");

    mockSocketContext.socket = originalSocket;
  });
});

describe("useService type safety", () => {
  let queryClient: QueryClient;

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
    mockSocket.emit.mockImplementation(
      (event: string, payload: unknown, callback?: (response: unknown) => void) => {
        if (callback) {
          callback({ success: true, data: {} });
        }
      }
    );
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("should accept valid service and method names", () => {
    // This test verifies TypeScript compilation - if these hooks
    // don't compile, the test will fail
    const { result: chatResult } = renderHook(
      () => useService("chatService", "createChat"),
      { wrapper }
    );
    expect(chatResult.current.mutate).toBeDefined();

    const { result: messageResult } = renderHook(
      () => useService("messageService", "postMessage"),
      { wrapper }
    );
    expect(messageResult.current.mutate).toBeDefined();

    const { result: userResult } = renderHook(
      () => useService("userService", "updateProfile"),
      { wrapper }
    );
    expect(userResult.current.mutate).toBeDefined();
  });
});
