// Slopbusters shim for upstream rpc.ts. Upstream's WsRpcGroup lists every RPC the engine serves,
// which pulls the whole contracts package into the reviewer's typecheck. Effect RPC clients match
// methods by tag and decode each reply with the schemas of the request that sent it, so a client
// built from a group of only the RPCs Slopbusters calls speaks the same protocol.
//
// Every declaration below except WsRpcGroup is a verbatim copy of upstream's; `pnpm t3:check`
// fails when one differs, and `pnpm t3:sync --tree engine` refreshes them. To call another RPC,
// copy its upstream declaration here, add it to WsRpcGroup and import its schemas.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import { EnvironmentAuthorizationError } from "./auth.ts";
import {
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
} from "./git.ts";
import { KeybindingsConfigError } from "./keybindings.ts";
import { OrchestrationDispatchCommandError } from "./orchestrationDispatch.ts";
import {
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationV2DispatchCommandError,
  OrchestrationV2GetShellSnapshotError,
  OrchestrationV2GetThreadProjectionError,
  OrchestrationV2RpcSchemas,
} from "./orchestrationV2.ts";
import { Project, ProjectMutation, ProjectMutationError } from "./project.ts";
import {
  ProjectCloneActionInput,
  ProjectCloneActionResult,
  ProjectCloneListEvent,
  ProjectCloneStartInput,
  ProjectCloneStartResult,
  ProjectCloneSubscribeInput,
} from "./projectClone.ts";
import { ServerConfig } from "./server.ts";
import { ServerSettingsError } from "./settings.ts";
import { SourceControlRepositoryError } from "./sourceControl.ts";

export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsListEntries: "projects.listEntries",
  projectsReadFile: "projects.readFile",
  projectsSearchContents: "projects.searchContents",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",
  projectsMutate: "projects.mutate",
  projectsEnsureScratch: "projects.ensureScratch",
  projectsCreateNew: "projects.createNew",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Filesystem methods
  filesystemBrowse: "filesystem.browse",
  filesystemGetMetadata: "filesystem.getMetadata",
  agentSessionsScan: "agentSessions.scan",
  agentSessionsImport: "agentSessions.import",
  assetsCreateUrl: "assets.createUrl",
  assetsPersistChatAttachments: "assets.persistChatAttachments",
  attachmentsCreateUploadUrl: "attachments.createUploadUrl",
  attachmentsDelete: "attachments.delete",

  // MCP Apps methods
  mcpAppsCallTool: "mcpApps.callTool",
  mcpAppsToolInfo: "mcpApps.toolInfo",
  mcpAppsReadResource: "mcpApps.readResource",
  mcpAppsUpdateModelContext: "mcpApps.updateModelContext",

  // Provider methods
  providerUploadFeedback: "provider.uploadFeedback",
  providerAuthStart: "provider.auth.start",
  providerConsumeResetCredit: "provider.consumeResetCredit",
  providerAuthComplete: "provider.auth.complete",
  chatGptReconnectProfile: "provider.chatgpt.reconnect-profile",
  chatGptImportProfile: "provider.chatgpt.import-profile",
  chatGptHandoffSubscribe: "provider.chatgpt.handoff.subscribe",
  codexAuthCallbackSubscribe: "provider.codex.auth-callback.subscribe",
  providerAuthRespond: "provider.auth.respond",
  providerAuthCancel: "provider.auth.cancel",
  providerAuthLogout: "provider.auth.logout",
  providerAuthSubscribe: "provider.auth.subscribe",
  providerInstallStart: "provider.install.start",
  providerInstallCancel: "provider.install.cancel",
  providerInstallSubscribe: "provider.install.subscribe",
  providerInstallRemove: "provider.install.remove",

  // VCS methods
  vcsPull: "vcs.pull",
  vcsRefreshStatus: "vcs.refreshStatus",
  vcsListRefs: "vcs.listRefs",
  vcsCreateWorktree: "vcs.createWorktree",
  vcsRemoveWorktree: "vcs.removeWorktree",
  vcsCreateRef: "vcs.createRef",
  vcsSwitchRef: "vcs.switchRef",
  vcsInit: "vcs.init",

  // Git workflow methods
  gitRunStackedAction: "git.runStackedAction",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  // Review methods
  reviewGetDiffPreview: "review.getDiffPreview",
  reviewGetDiffFileContents: "review.getDiffFileContents",

  // Terminal methods
  terminalOpen: "terminal.open",
  terminalAttach: "terminal.attach",
  terminalObserve: "terminal.observe",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  // Preview methods
  previewOpen: "preview.open",
  previewNavigate: "preview.navigate",
  previewResize: "preview.resize",
  previewAdjust: "preview.adjust",
  previewRefresh: "preview.refresh",
  previewClose: "preview.close",
  previewList: "preview.list",
  previewClearProfile: "preview.clearProfile",
  previewReportProfiles: "preview.reportProfiles",
  previewReportStatus: "preview.reportStatus",

  // Device methods
  deviceConfigure: "device.configure",
  deviceList: "device.list",
  deviceTestHost: "device.testHost",
  deviceOpen: "device.open",
  deviceClose: "device.close",
  deviceShutdown: "device.shutdown",
  deviceDetail: "device.detail",
  deviceAction: "device.action",

  // Server meta
  serverProbe: "server.probe",
  serverGetConfig: "server.getConfig",
  serverRefreshProviders: "server.refreshProviders",
  serverUpdateProvider: "server.updateProvider",
  serverUpdateServer: "server.updateServer",
  serverUpdateServerWithProgress: "server.updateServerWithProgress",
  serverCommitDesktopUpdate: "server.commitDesktopUpdate",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverRemoveKeybinding: "server.removeKeybinding",
  serverRunStorageCleanup: "server.runStorageCleanup",
  serverGetStorageCleanupReport: "server.getStorageCleanupReport",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",
  serverDiscoverSourceControl: "server.discoverSourceControl",
  serverSearchAcpRegistry: "server.searchAcpRegistry",
  serverPrepareAcpRegistryAgent: "server.prepareAcpRegistryAgent",
  serverUninstallAcpRegistryManagedBinary: "server.uninstallAcpRegistryManagedBinary",
  serverAcceptAcpRegistryUrlAuth: "server.acceptAcpRegistryUrlAuth",
  serverListAcpRegistrySessions: "server.listAcpRegistrySessions",
  serverImportAcpRegistrySession: "server.importAcpRegistrySession",
  serverDeleteAcpRegistrySession: "server.deleteAcpRegistrySession",
  serverListAcpRegistryProviders: "server.listAcpRegistryProviders",
  serverSetAcpRegistryProvider: "server.setAcpRegistryProvider",
  serverDisableAcpRegistryProvider: "server.disableAcpRegistryProvider",
  serverLogoutAcpRegistry: "server.logoutAcpRegistry",
  serverGetTraceDiagnostics: "server.getTraceDiagnostics",
  serverGetProcessDiagnostics: "server.getProcessDiagnostics",
  serverGetHostResources: "server.getHostResources",
  serverGetProcessResourceHistory: "server.getProcessResourceHistory",
  serverGetResourceTelemetryHistory: "server.getResourceTelemetryHistory",
  serverRetryResourceTelemetry: "server.retryResourceTelemetry",
  serverCheckOtlpEndpoint: "server.checkOtlpEndpoint",
  serverSignalProcess: "server.signalProcess",
  serverReportClientActivity: "server.reportClientActivity",
  serverReportHostPowerState: "server.reportHostPowerState",
  serverGetBackgroundPolicy: "server.getBackgroundPolicy",
  serverGetUsageSummary: "server.getUsageSummary",
  serverRefreshUsageRates: "server.refreshUsageRates",

  // Scheduled tasks
  scheduledTasksList: "scheduledTasks.list",
  scheduledTasksSubscribe: "scheduledTasks.subscribe",
  scheduledTasksUpsert: "scheduledTasks.upsert",
  scheduledTasksSetEnabled: "scheduledTasks.setEnabled",
  scheduledTasksDelete: "scheduledTasks.delete",
  scheduledTasksRunNow: "scheduledTasks.runNow",
  scheduledTasksRotateWebhookToken: "scheduledTasks.rotateWebhookToken",
  secretsAnswerRequest: "secrets.answerRequest",
  scheduledTasksListWebhookDeliveries: "scheduledTasks.listWebhookDeliveries",
  scheduledTasksGetWebhookDelivery: "scheduledTasks.getWebhookDelivery",

  // Cloud environment methods
  cloudGetRelayClientStatus: "cloud.getRelayClientStatus",
  cloudInstallRelayClient: "cloud.installRelayClient",

  // Pull request methods
  pullRequestsList: "pullRequests.list",
  pullRequestsListStats: "pullRequests.listStats",
  pullRequestsSummary: "pullRequests.summary",
  pullRequestsRouting: "pullRequests.routing",
  pullRequestsRoutingIdentity: "pullRequests.routingIdentity",
  pullRequestsStack: "pullRequests.stack",
  pullRequestsLinkedThreads: "pullRequests.linkedThreads",
  pullRequestsDetail: "pullRequests.detail",
  pullRequestsPreview: "pullRequests.preview",
  pullRequestsChecks: "pullRequests.checks",
  pullRequestsActivity: "pullRequests.activity",
  pullRequestsReviewGuide: "pullRequests.reviewGuide",
  pullRequestsGenerateReviewGuide: "pullRequests.generateReviewGuide",
  pullRequestsThreadComments: "pullRequests.threadComments",
  pullRequestsDiffFileContents: "pullRequests.diffFileContents",
  pullRequestsFilesViewed: "pullRequests.filesViewed",
  pullRequestsSetFilesViewed: "pullRequests.setFilesViewed",
  pullRequestsRunAction: "pullRequests.runAction",
  pullRequestsUpdate: "pullRequests.update",
  pullRequestsComment: "pullRequests.comment",
  pullRequestsUpdateComment: "pullRequests.updateComment",
  pullRequestsSubmitReview: "pullRequests.submitReview",
  pullRequestsReplyToThread: "pullRequests.replyToThread",
  pullRequestsSetThreadResolution: "pullRequests.setThreadResolution",
  pullRequestsSetReaction: "pullRequests.setReaction",
  pullRequestsInvalidate: "pullRequests.invalidate",
  pullRequestsReportState: "pullRequests.reportState",
  pullRequestsSubscribeRefreshes: "pullRequests.subscribeRefreshes",
  pullRequestsReviewerCandidates: "pullRequests.reviewerCandidates",
  pullRequestsRequestReviewers: "pullRequests.requestReviewers",
  pullRequestsLabelCandidates: "pullRequests.labelCandidates",
  pullRequestsSetLabels: "pullRequests.setLabels",

  // Source control methods
  sourceControlLookupRepository: "sourceControl.lookupRepository",
  sourceControlCloneRepository: "sourceControl.cloneRepository",
  sourceControlPublishRepository: "sourceControl.publishRepository",
  projectCloneStart: "projectClone.start",
  projectCloneCancel: "projectClone.cancel",
  projectCloneRetry: "projectClone.retry",
  subscribeProjectClones: "subscribeProjectClones",

  // Streaming subscriptions
  subscribeVcsStatus: "subscribeVcsStatus",
  subscribeWorktreeSetup: "subscribeWorktreeSetup",
  worktreeSetupCancel: "worktreeSetup.cancel",
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeTerminalMetadata: "subscribeTerminalMetadata",
  subscribePreviewEvents: "subscribePreviewEvents",
  subscribeDiscoveredLocalServers: "subscribeDiscoveredLocalServers",
  subscribeDeviceState: "subscribeDeviceState",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
  subscribeAuthAccess: "subscribeAuthAccess",
  subscribeBackgroundPolicy: "subscribeBackgroundPolicy",
  subscribeResourceTelemetry: "subscribeResourceTelemetry",
} as const;

const WsServerProbeRpc = Rpc.make(WS_METHODS.serverProbe, {
  payload: Schema.Struct({}),
  success: Schema.Struct({}),
  error: EnvironmentAuthorizationError,
});

const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, EnvironmentAuthorizationError]),
});

const WsProjectsMutateRpc = Rpc.make(WS_METHODS.projectsMutate, {
  payload: ProjectMutation,
  success: Project,
  error: Schema.Union([ProjectMutationError, EnvironmentAuthorizationError]),
});

const WsProjectCloneStartRpc = Rpc.make(WS_METHODS.projectCloneStart, {
  payload: ProjectCloneStartInput,
  success: ProjectCloneStartResult,
  error: Schema.Union([
    SourceControlRepositoryError,
    OrchestrationDispatchCommandError,
    EnvironmentAuthorizationError,
  ]),
});

const WsProjectCloneRetryRpc = Rpc.make(WS_METHODS.projectCloneRetry, {
  payload: ProjectCloneActionInput,
  success: ProjectCloneActionResult,
  error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
});

const WsSubscribeProjectClonesRpc = Rpc.make(WS_METHODS.subscribeProjectClones, {
  payload: ProjectCloneSubscribeInput,
  success: ProjectCloneListEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2DispatchCommandRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, {
  payload: OrchestrationV2RpcSchemas.dispatchCommand.input,
  success: OrchestrationV2RpcSchemas.dispatchCommand.output,
  error: Schema.Union([OrchestrationV2DispatchCommandError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2SubscribeShellRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.subscribeShell, {
  payload: OrchestrationV2RpcSchemas.subscribeShell.input,
  success: OrchestrationV2RpcSchemas.subscribeShell.output,
  error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsOrchestrationV2SubscribeThreadRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.subscribeThread, {
  payload: OrchestrationV2RpcSchemas.subscribeThread.input,
  success: OrchestrationV2RpcSchemas.subscribeThread.output,
  error: Schema.Union([OrchestrationV2GetThreadProjectionError, EnvironmentAuthorizationError]),
  stream: true,
});

export class RpcScopeAuthorization extends RpcMiddleware.Service<RpcScopeAuthorization>()(
  "t3/contracts/RpcScopeAuthorization",
  { error: EnvironmentAuthorizationError },
) {}

/** The RPCs Slopbusters calls, out of upstream's full WsRpcGroup. */
export const WsRpcGroup = RpcGroup.make(
  WsServerProbeRpc,
  WsServerGetConfigRpc,
  WsProjectsMutateRpc,
  WsProjectCloneStartRpc,
  WsProjectCloneRetryRpc,
  WsSubscribeProjectClonesRpc,
  WsGitPreparePullRequestThreadRpc,
  WsOrchestrationV2DispatchCommandRpc,
  WsOrchestrationV2SubscribeShellRpc,
  WsOrchestrationV2SubscribeThreadRpc,
).middleware(RpcScopeAuthorization);
