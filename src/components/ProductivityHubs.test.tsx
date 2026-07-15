import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bridge, type ScheduledTask } from "../lib/bridge";
import { ScheduledTasksHub } from "./ScheduledTasksHub";
import { PluginsHub } from "./PluginsHub";
import { SitesHub } from "./SitesHub";
import { PullRequestsHub } from "./PullRequestsHub";

vi.mock("../lib/bridge", () => ({ bridge: {
  isNative: vi.fn(), listScheduledTasks: vi.fn(), saveScheduledTask: vi.fn(), deleteScheduledTask: vi.fn(),
  toggleScheduledTask: vi.fn(), createOrchestrationJob: vi.fn(), markScheduledTaskRun: vi.fn(), dispatchOrchestrationJob: vi.fn(),
  codexPluginCatalog: vi.fn(), installCodexPlugin: vi.fn(), removeCodexPlugin: vi.fn(), sitesStatus: vi.fn(), pullRequestStatus: vi.fn(), reveal: vi.fn(), openUrl: vi.fn(), openGptSection: vi.fn(),
} }));

const task: ScheduledTask = {
  id: "schedule-1", title: "Daily health check", prompt: "Run tests and summarize failures.", recurrence: "daily",
  nextRunAtMs: Date.now() + 60_000, enabled: true, mode: "verify", createdAtMs: Date.now(),
};

describe("GPT-aligned productivity hubs", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(bridge.isNative).mockReturnValue(true); });

  it("loads persisted schedules and creates a real schedule request", async () => {
    vi.mocked(bridge.listScheduledTasks).mockResolvedValue([task]);
    vi.mocked(bridge.saveScheduledTask).mockResolvedValue(task);
    render(<ScheduledTasksHub workspace="C:/workspace" />);
    expect(await screen.findByText("Daily health check")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    fireEvent.change(screen.getByPlaceholderText("Daily repository health check"), { target: { value: "Weekly review" } });
    fireEvent.change(screen.getByPlaceholderText(/Inspect the workspace/), { target: { value: "Review open work" } });
    fireEvent.click(screen.getByRole("button", { name: /create schedule/i }));
    await waitFor(() => expect(bridge.saveScheduledTask).toHaveBeenCalledWith(expect.objectContaining({ workspace: "C:/workspace", title: "Weekly review", prompt: "Review open work", recurrence: "once", mode: "build" })));
  });

  it("shows installed Codex plugin manifest metadata", async () => {
    vi.mocked(bridge.codexPluginCatalog).mockResolvedValue({ installed: [{ pluginId:"sites@openai-bundled", id:"sites", marketplaceName:"openai-bundled", installed:true, enabled:true, displayName:"Sites", description:"Build and deploy websites", version:"0.1.27", developerName:"OpenAI", category:"Productivity", capabilities:["Interactive","Write"], brandColor:"#0C79D8", manifestPath:"C:/plugins/sites/plugin.json" }], available: [] });
    render(<PluginsHub />);
    expect(await screen.findByRole("heading", { name: "Sites" })).toBeVisible();
    expect(screen.getByText("v0.1.27")).toBeVisible();
    expect(screen.getByText("Write")).toBeVisible();
  });

  it("does not invent Sites deployment state when hosting config is absent", async () => {
    vi.mocked(bridge.sitesStatus).mockResolvedValue({ pluginInstalled:true, pluginVersion:"0.1.27", configExists:false, configPath:"C:/workspace/.openai/hosting.json" });
    render(<SitesHub workspace="C:/workspace" />);
    expect(await screen.findByText("Sites plugin installed")).toBeVisible();
    expect(screen.getByText("Not connected to a Site")).toBeVisible();
    expect(screen.getByText(/never invent a project ID or deployment URL/i)).toBeVisible();
  });

  it("surfaces a repository without an origin instead of fake PRs", async () => {
    vi.mocked(bridge.pullRequestStatus).mockResolvedValue({ isRepository:true, branch:"master", remoteUrl:null, githubAuthenticated:true, accountLogin:"ZachDreamZ", pullRequests:[], previouslyReviewed:[], message:"This repository has no origin remote." });
    render(<PullRequestsHub workspace="C:/workspace" />);
    expect(await screen.findByText("This repository has no origin remote.")).toBeVisible();
    expect(screen.getByText("No origin remote")).toBeVisible();
    expect(screen.getByText("No pull requests to show")).toBeVisible();
  });
});
