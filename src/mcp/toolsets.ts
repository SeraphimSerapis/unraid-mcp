import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";

export type ToolsetName = "health" | "docker" | "plugins";

export class ToolsetRegistry {
  private readonly tools = new Map<ToolsetName, RegisteredTool[]>();

  add(name: ToolsetName, tool: RegisteredTool) {
    const existing = this.tools.get(name) ?? [];
    existing.push(tool);
    this.tools.set(name, existing);
  }

  enable(name: ToolsetName) {
    for (const tool of this.tools.get(name) ?? []) {
      tool.enable();
    }
  }

  disable(name: ToolsetName) {
    for (const tool of this.tools.get(name) ?? []) {
      tool.disable();
    }
  }

  list() {
    return [...this.tools.entries()].map(([name, tools]) => ({
      enabled: tools.some((tool) => tool.enabled),
      name,
      tools: tools.map((tool) => tool.title ?? tool.description ?? "registered tool"),
    }));
  }
}
