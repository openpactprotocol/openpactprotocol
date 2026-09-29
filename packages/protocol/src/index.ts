import { z } from "zod";

export const A2A_VERSION = "1.0";

export const A2A_METHODS = {
  sendMessage: "SendMessage",
  sendStreamingMessage: "SendStreamingMessage",
  getTask: "GetTask",
  listTasks: "ListTasks",
  cancelTask: "CancelTask",
  subscribeToTask: "SubscribeToTask",
  createTaskPushNotificationConfig: "CreateTaskPushNotificationConfig",
  getTaskPushNotificationConfig: "GetTaskPushNotificationConfig",
  listTaskPushNotificationConfigs: "ListTaskPushNotificationConfigs",
  deleteTaskPushNotificationConfig: "DeleteTaskPushNotificationConfig",
  getExtendedAgentCard: "GetExtendedAgentCard",
} as const;

export const A2A_ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  serverError: -32000,
  taskNotFound: -32001,
  taskNotCancelable: -32002,
  pushNotificationNotSupported: -32003,
  unsupportedOperation: -32004,
  contentTypeNotSupported: -32005,
  extendedAgentCardNotConfigured: -32007,
  versionNotSupported: -32009,
} as const;

export const RoleSchema = z.enum(["ROLE_UNSPECIFIED", "ROLE_USER", "ROLE_AGENT"]);
export const TaskStateSchema = z.enum([
  "TASK_STATE_UNSPECIFIED",
  "TASK_STATE_SUBMITTED",
  "TASK_STATE_WORKING",
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_REJECTED",
  "TASK_STATE_AUTH_REQUIRED",
]);

const JsonValueSchema: z.ZodType<unknown> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.lazy(() => JsonValueSchema)),
  z.record(
    z.string(),
    z.lazy(() => JsonValueSchema),
  ),
]);

const partFields = {
  metadata: z.record(z.string(), z.unknown()).optional(),
  filename: z.string().optional(),
  mediaType: z.string().optional(),
};

export const PartSchema = z.union([
  z.object({ ...partFields, text: z.string() }).strict(),
  z
    .object({
      ...partFields,
      raw: z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
    })
    .strict(),
  z.object({ ...partFields, url: z.string() }).strict(),
  z.object({ ...partFields, data: JsonValueSchema }).strict(),
]);

export const MessageSchema = z.object({
  messageId: z.string().min(1),
  contextId: z.string().optional(),
  taskId: z.string().optional(),
  role: RoleSchema,
  parts: z.array(PartSchema).min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  extensions: z.array(z.string()).optional(),
  referenceTaskIds: z.array(z.string()).optional(),
});

export const TaskStatusSchema = z.object({
  state: TaskStateSchema,
  message: MessageSchema.optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
});

export const ArtifactSchema = z.object({
  artifactId: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  parts: z.array(PartSchema).min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  extensions: z.array(z.string()).optional(),
});

export const TaskSchema = z.object({
  id: z.string().min(1),
  contextId: z.string().min(1),
  status: TaskStatusSchema,
  artifacts: z.array(ArtifactSchema).optional(),
  history: z.array(MessageSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const SendMessageConfigurationSchema = z.object({
  acceptedOutputModes: z.array(z.string()).optional(),
  taskPushNotificationConfig: z.record(z.string(), z.unknown()).optional(),
  historyLength: z.number().int().nonnegative().optional(),
  returnImmediately: z.boolean().optional(),
});

export const SendMessageRequestSchema = z.object({
  tenant: z.string().optional(),
  message: MessageSchema,
  configuration: SendMessageConfigurationSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const SendMessageResponseSchema = z.union([
  z.object({ task: TaskSchema }).strict(),
  z.object({ message: MessageSchema }).strict(),
]);

export const GetTaskRequestSchema = z.object({
  tenant: z.string().optional(),
  id: z.string().min(1),
  historyLength: z.number().int().nonnegative().optional(),
});

export const ListTasksRequestSchema = z.object({
  tenant: z.string().optional(),
  contextId: z.string().optional(),
  status: TaskStateSchema.optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
  historyLength: z.number().int().nonnegative().optional(),
  statusTimestampAfter: z.string().datetime({ offset: true }).optional(),
  includeArtifacts: z.boolean().optional(),
});

export const ListTasksResponseSchema = z.object({
  tasks: z.array(TaskSchema),
  nextPageToken: z.string(),
  pageSize: z.number().int(),
  totalSize: z.number().int(),
});

export const CancelTaskRequestSchema = z.object({
  tenant: z.string().optional(),
  id: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const SecuritySchemeSchema = z.union([
  z
    .object({
      apiKeySecurityScheme: z.object({
        name: z.string(),
        location: z.string(),
        description: z.string().optional(),
      }),
    })
    .strict(),
  z
    .object({
      httpAuthSecurityScheme: z.object({
        scheme: z.string(),
        bearerFormat: z.string().optional(),
        description: z.string().optional(),
      }),
    })
    .strict(),
  z.object({ oauth2SecurityScheme: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ openIdConnectSecurityScheme: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ mtlsSecurityScheme: z.record(z.string(), z.unknown()) }).strict(),
]);

export const SecurityRequirementSchema = z.object({
  schemes: z.record(z.string(), z.object({ list: z.array(z.string()) })),
});

export const AgentInterfaceSchema = z.object({
  url: z.string().url(),
  protocolBinding: z.string(),
  tenant: z.string().optional(),
  protocolVersion: z.string(),
});

export const AgentProviderSchema = z.object({
  url: z.string().url(),
  organization: z.string(),
});

export const AgentExtensionSchema = z.object({
  uri: z.string(),
  description: z.string(),
  required: z.boolean(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const AgentCapabilitiesSchema = z.object({
  streaming: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  extensions: z.array(AgentExtensionSchema).optional(),
  extendedAgentCard: z.boolean().optional(),
});

export const AgentSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  examples: z.array(z.string()).optional(),
  inputModes: z.array(z.string()).optional(),
  outputModes: z.array(z.string()).optional(),
  securityRequirements: z.array(SecurityRequirementSchema).optional(),
});

export const AgentCardSchema = z.object({
  name: z.string(),
  description: z.string(),
  supportedInterfaces: z.array(AgentInterfaceSchema),
  provider: AgentProviderSchema.optional(),
  version: z.string(),
  documentationUrl: z.string().url().optional(),
  capabilities: AgentCapabilitiesSchema,
  securitySchemes: z.record(z.string(), SecuritySchemeSchema).optional(),
  securityRequirements: z.array(SecurityRequirementSchema).optional(),
  defaultInputModes: z.array(z.string()),
  defaultOutputModes: z.array(z.string()),
  skills: z.array(AgentSkillSchema),
  signatures: z.array(z.record(z.string(), z.unknown())).optional(),
  iconUrl: z.string().url().optional(),
});

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

export const JsonRpcErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
});

export const JsonRpcResponseSchema = z.union([
  z.object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number(), z.null()]),
    result: z.unknown(),
  }),
  z.object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number(), z.null()]),
    error: JsonRpcErrorSchema,
  }),
]);

export const PlatformJwtClaimsSchema = z.object({
  iss: z.string(),
  sub: z.string().min(1),
  aud: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().min(1),
});

export type Role = z.infer<typeof RoleSchema>;
export type TaskState = z.infer<typeof TaskStateSchema>;
export type Part = z.infer<typeof PartSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type SendMessageConfiguration = z.infer<typeof SendMessageConfigurationSchema>;
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;
export type SendMessageResponse = z.infer<typeof SendMessageResponseSchema>;
export type GetTaskRequest = z.infer<typeof GetTaskRequestSchema>;
export type ListTasksRequest = z.infer<typeof ListTasksRequestSchema>;
export type ListTasksResponse = z.infer<typeof ListTasksResponseSchema>;
export type CancelTaskRequest = z.infer<typeof CancelTaskRequestSchema>;
export type SecurityScheme = z.infer<typeof SecuritySchemeSchema>;
export type SecurityRequirement = z.infer<typeof SecurityRequirementSchema>;
export type AgentInterface = z.infer<typeof AgentInterfaceSchema>;
export type AgentProvider = z.infer<typeof AgentProviderSchema>;
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>;
export type AgentExtension = z.infer<typeof AgentExtensionSchema>;
export type AgentSkill = z.infer<typeof AgentSkillSchema>;
export type AgentCard = z.infer<typeof AgentCardSchema>;
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;
export type JsonRpcError = z.infer<typeof JsonRpcErrorSchema>;
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;
export type PlatformJwtClaims = z.infer<typeof PlatformJwtClaimsSchema>;
