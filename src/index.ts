import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { MemoryInput } from './types.ts';
import {
  MemoryToolInputSchema,
  executeMemoryOperation,
  validateToolInput,
} from './vscode-memory.ts';

export default function vscodeMemoryExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'memory',
    label: 'Persistent Memory',
    description:
      'Store and retrieve persistent facts across session (/memories/session), repository (/memories/sessions), and global (/memories) scopes. Each path is a fully qualified virtual path encoding its own scope. Operations: view (retrieve), create (new note), str_replace (update), insert (append line), delete (remove), rename (move file).',
    parameters: MemoryToolInputSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const sessionId = ctx.sessionManager.getSessionId();
        const validated = validateToolInput(params, { sessionId }) as MemoryInput;
        const result = await executeMemoryOperation(validated, sessionId, ctx.cwd);

        if (result.success) {
          const isEmptyView = validated.operation === 'view' && !result.data;
          return {
            content: [
              {
                type: 'text',
                text: isEmptyView
                  ? `Empty: '${validated.path}' does not exist yet (or is empty). Definite result, no need to retry.`
                  : result.data || `Operation '${validated.operation}' completed successfully.`,
              },
            ],
            details: {
              scope: validated.scope,
              operation: validated.operation,
              path: validated.path,
              success: true,
            },
          };
        }

        return {
          content: [{ type: 'text', text: `Error: ${result.error}` }],
          details: {
            scope: validated.scope,
            operation: validated.operation,
            path: validated.path,
            success: false,
            error: result.error,
          },
          isError: true,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Fatal error: ${message}` }],
          details: { success: false, error: message },
          isError: true,
        };
      }
    },
  });
}
