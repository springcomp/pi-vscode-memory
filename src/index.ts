import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { MemoryInput } from './types.js';
import {
  MemoryToolInputSchema,
  executeMemoryOperation,
  validateToolInput,
} from './vscode-memory.js';

export default function vscodeMemoryExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'vscode_memory',
    label: 'VSCode Memory',
    description:
      'Store and retrieve persistent notes across session, repository, and user scopes. Operations: view, create, str_replace, insert, delete, rename.',
    parameters: MemoryToolInputSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const sessionId = ctx.sessionManager.getSessionId();
        const validated = validateToolInput(params, { sessionId }) as MemoryInput;
        const result = await executeMemoryOperation(validated, sessionId, ctx.cwd);

        if (result.success) {
          return {
            content: [
              {
                type: 'text',
                text: result.data || `Operation '${validated.operation}' completed successfully.`,
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
