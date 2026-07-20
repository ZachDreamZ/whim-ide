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
  codexPluginCatalog: vi.fn(), installCodexPlugin: vi.fn(), removeCodexPlugin: vi.fn(), sitesStatus: vi.fn(),
  pullRequestStatus: vi.fn(), reveal: vi.fn(), openUrl: vi.fn(), openGptSection: vi.fn(),
  createPullRequest: vi.fn(), mergePullRequest: vi.fn(), commentOnPullRequest: vi.fn(),
  githubConnect: vi.fn(), githubDisconnect: vi.fn(),
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

  it("shows connect button when not authenticated", async () => {
    vi.mocked(bridge.pullRequestStatus).mockResolvedValue({ isRepository:true, branch:"main", remoteUrl:"https://github.com/owner/repo", githubAuthenticated:false, accountLogin:null, pullRequests:[], previouslyReviewed:[], message:null });
    render(<PullRequestsHub workspace="C:/workspace" />);
    expect(await screen.findByRole("button", { name: /Connect GitHub/i })).toBeVisible();
  });

  it("shows new PR button when authenticated", async () => {
    vi.mocked(bridge.pullRequestStatus).mockResolvedValue({ isRepository:true, branch:"main", remoteUrl:"https://github.com/owner/repo", githubAuthenticated:true, accountLogin:"octocat", pullRequests:[], previouslyReviewed:[], message:null });
    render(<PullRequestsHub workspace="C:/workspace" />);
    expect(await screen.findByRole("button", { name: /New PR/i })).toBeVisible();
  });

  it("opens PR creation form and calls createPullRequest", async () => {
    vi.mocked(bridge.pullRequestStatus).mockResolvedValue({ isRepository:true, branch:"feature", remoteUrl:"https://github.com/owner/repo", githubAuthenticated:true, accountLogin:"octocat", pullRequests:[], previouslyReviewed:[], message:null });
    vi.mocked(bridge.createPullRequest).mockResolvedValue({ number: 42, url: "https://github.com/owner/repo/pull/42" });
    render(<PullRequestsHub workspace="C:/workspace" />);

    await waitFor(() => fireEvent.click(screen.getByRole("button", { name: /New PR/i })));
    expect(screen.getByPlaceholderText("PR title")).toBeVisible();

    fireEvent.change(screen.getByPlaceholderText("PR title"), { target: { value: "My feature PR" } });
    fireEvent.change(screen.getByPlaceholderText("feature-branch"), { target: { value: "my-feature" } });
    fireEvent.click(screen.getByRole("button", { name: /Create PR/i }));

    await waitFor(() => expect(bridge.createPullRequest).toHaveBeenCalledWith("C:/workspace", {
      title: "My feature PR",
      body: undefined,
      head: "my-feature",
      base: "main",
      draft: false,
    }));
  });

  it("shows merge button on open PRs", async () => {
    vi.mocked(bridge.pullRequestStatus).mockResolvedValue({
      isRepository:true, branch:"main", remoteUrl:"https://github.com/owner/repo", githubAuthenticated:true, accountLogin:"octocat",
      pullRequests: [{ number:1, title:"Fix bug", state:"OPEN", isDraft:false, url:"https://github.com/owner/repo/pull/1", headRefName:"fix", baseRefName:"main", author:"user1", updatedAt:null, repository:"owner/repo", relationship:"reviewing" }],
      previouslyReviewed: [], message:null,
    });
    render(<PullRequestsHub workspace="C:/workspace" />);

    expect(await screen.findByTitle("Merge")).toBeVisible();
  });

  it("shows comment button on open PRs and opens comment form", async () => {
    vi.mocked(bridge.pullRequestStatus).mockResolvedValue({
      isRepository:true, branch:"main", remoteUrl:"https://github.com/owner/repo", githubAuthenticated:true, accountLogin:"octocat",
      pullRequests: [{ number:1, title:"Fix bug", state:"OPEN", isDraft:false, url:"https://github.com/owner/repo/pull/1", headRefName:"fix", baseRefName:"main", author:"user1", updatedAt:null, repository:"owner/repo", relationship:"reviewing" }],
      previouslyReviewed: [], message:null,
    });
    render(<PullRequestsHub workspace="C:/workspace" />);

    await waitFor(() => fireEvent.click(screen.getByTitle("Comment")));
    expect(screen.getByPlaceholderText("Write a comment...")).toBeVisible();
  });

  it("shows previously reviewed section", async () => {
    vi.mocked(bridge.pullRequestStatus).mockResolvedValue({
      isRepository:true, branch:"main", remoteUrl:"https://github.com/owner/repo", githubAuthenticated:true, accountLogin:"octocat",
      pullRequests: [],
      previouslyReviewed: [{ number:10, title:"Old PR", state:"MERGED", isDraft:false, url:"https://github.com/owner/repo/pull/10", headRefName:"old", baseRefName:"main", author:"user2", updatedAt:null, repository:"owner/repo", relationship:"reviewed" }],
      message:null,
    });
    render(<PullRequestsHub workspace="C:/workspace" />);

    expect(await screen.findByText(/Previously reviewed/i)).toBeVisible();
    expect(screen.getByText(/Old PR/i)).toBeVisible();
  });
});
