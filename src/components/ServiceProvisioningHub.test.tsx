import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceProvisioningHub } from "./ServiceProvisioningHub";

const listServices = vi.fn();
const provisionService = vi.fn();
const stopService = vi.fn();
const startService = vi.fn();
const removeService = vi.fn();

vi.mock("../lib/bridge", () => ({
  bridge: {
    listServices: (...args: unknown[]) => listServices(...args),
    provisionService: (...args: unknown[]) => provisionService(...args),
    stopService: (...args: unknown[]) => stopService(...args),
    startService: (...args: unknown[]) => startService(...args),
    removeService: (...args: unknown[]) => removeService(...args),
    isNative: () => true,
  },
  errorMessage: (cause: unknown) => cause instanceof Error ? cause.message : String(cause),
}));

describe("ServiceProvisioningHub", () => {
  beforeEach(() => {
    listServices.mockReset();
    provisionService.mockReset();
    stopService.mockReset();
    startService.mockReset();
    removeService.mockReset();
  });

  it("shows empty state when no services exist", async () => {
    listServices.mockResolvedValue([]);
    render(<ServiceProvisioningHub />);

    await waitFor(() => expect(screen.getByText(/No services provisioned/i)).toBeVisible());
  });

  it("lists provisioned services", async () => {
    listServices.mockResolvedValue([
      { id: "pg-1", kind: "Postgres", name: "My DB", status: "Running", port: 5432, connectionString: "postgresql://user:pass@127.0.0.1:5432/db", createdAtMs: 1000 },
    ]);
    render(<ServiceProvisioningHub />);

    await waitFor(() => expect(screen.getByText(/My DB/i)).toBeVisible());
    expect(screen.getByText(/Running/i)).toBeVisible();
  });

  it("shows provision form when Provision button clicked", async () => {
    listServices.mockResolvedValue([]);
    render(<ServiceProvisioningHub />);

    await waitFor(() => fireEvent.click(screen.getByRole("button", { name: /Provision/i })));
    expect(screen.getByText(/New service/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /Provision Postgres/i })).toBeVisible();
  });

  it("calls provisionService on form submit", async () => {
    listServices.mockResolvedValue([]);
    provisionService.mockResolvedValue({ id: "pg-1", kind: "Postgres", name: "", status: "Running", port: 5432, connectionString: "postgresql://...", createdAtMs: 0 });
    render(<ServiceProvisioningHub />);

    await waitFor(() => fireEvent.click(screen.getByRole("button", { name: /Provision/i })));
    fireEvent.click(screen.getByRole("button", { name: /Provision Postgres/i }));

    await waitFor(() => expect(provisionService).toHaveBeenCalledWith({ kind: "Postgres", name: undefined }));
  });

  it("shows stop button for running services", async () => {
    listServices.mockResolvedValue([
      { id: "redis-1", kind: "Redis", name: "Cache", status: "Running", port: 6379, connectionString: "redis://:pass@127.0.0.1:6379", createdAtMs: 1000 },
    ]);
    render(<ServiceProvisioningHub />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Stop/i })).toBeVisible());
  });

  it("calls stopService on stop click", async () => {
    stopService.mockResolvedValue({ id: "redis-1", kind: "Redis", name: "Cache", status: "Stopped", port: 6379, connectionString: "redis://...", createdAtMs: 0 });
    listServices.mockResolvedValue([
      { id: "redis-1", kind: "Redis", name: "Cache", status: "Running", port: 6379, connectionString: "redis://...", createdAtMs: 1000 },
    ]);
    render(<ServiceProvisioningHub />);

    await waitFor(() => fireEvent.click(screen.getByRole("button", { name: /Stop/i })));
    await waitFor(() => expect(stopService).toHaveBeenCalledWith("redis-1"));
  });

  it("shows start button for stopped services", async () => {
    listServices.mockResolvedValue([
      { id: "redis-1", kind: "Redis", name: "Cache", status: "Stopped", port: 6379, connectionString: "redis://...", createdAtMs: 1000 },
    ]);
    render(<ServiceProvisioningHub />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Start/i })).toBeVisible());
  });

  it("calls startService on start click", async () => {
    startService.mockResolvedValue({ id: "redis-1", kind: "Redis", name: "Cache", status: "Running", port: 6379, connectionString: "redis://...", createdAtMs: 0 });
    listServices.mockResolvedValue([
      { id: "redis-1", kind: "Redis", name: "Cache", status: "Stopped", port: 6379, connectionString: "redis://...", createdAtMs: 1000 },
    ]);
    render(<ServiceProvisioningHub />);

    await waitFor(() => fireEvent.click(screen.getByRole("button", { name: /Start/i })));
    await waitFor(() => expect(startService).toHaveBeenCalledWith("redis-1"));
  });

  it("calls removeService on remove click", async () => {
    removeService.mockResolvedValue(undefined);
    listServices.mockResolvedValue([
      { id: "pg-1", kind: "Postgres", name: "My DB", status: "Stopped", port: 5432, connectionString: "postgresql://...", createdAtMs: 1000 },
    ]);
    render(<ServiceProvisioningHub />);

    await waitFor(() => fireEvent.click(screen.getByRole("button", { name: /Remove/i })));
    await waitFor(() => expect(removeService).toHaveBeenCalledWith("pg-1"));
  });

  it("toggles connection string visibility", async () => {
    listServices.mockResolvedValue([
      { id: "pg-1", kind: "Postgres", name: "DB", status: "Running", port: 5432, connectionString: "postgresql://user:secret@127.0.0.1:5432/db", createdAtMs: 1000 },
    ]);
    render(<ServiceProvisioningHub />);

    await waitFor(() => {
      expect(document.querySelector("code")).toBeVisible();
    });
    expect(screen.getByRole("button", { name: /Show/i })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Show/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Hide/i })).toBeVisible();
    });
  });
});
