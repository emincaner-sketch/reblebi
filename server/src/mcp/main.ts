#!/usr/bin/env node
/**
 * SosyalPilot MCP stdio köprüsü.
 * Sadece yerel (stdio) MCP destekleyen istemciler için: tüm istekleri uzaktaki /mcp uç noktasına iletir.
 * Araç tanımları tek yerde (sunucuda) durur; bu dosya sadece taşıyıcıdır.
 *
 * Ortam değişkenleri:
 *   SOSYALPILOT_API_URL  (varsayılan http://localhost:4100)
 *   SOSYALPILOT_API_KEY  (Panel > Ayarlar > API & MCP)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const base = (process.env.SOSYALPILOT_API_URL || "http://localhost:4100").replace(/\/$/, "");
const key = process.env.SOSYALPILOT_API_KEY || "";

if (!key) {
  process.stderr.write("SOSYALPILOT_API_KEY tanımlı değil. Panel > Ayarlar > API & MCP bölümünden bir anahtar oluştur.\n");
  process.exit(1);
}

const client = new Client({ name: "sosyalpilot-stdio-bridge", version: "2.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));

const remote = client.getServerVersion();
const server = new Server(
  { name: remote?.name ?? "sosyalpilot", version: remote?.version ?? "2.0.0" },
  { capabilities: { tools: {}, prompts: {} }, instructions: client.getInstructions() },
);

server.setRequestHandler(ListToolsRequestSchema, async (req) => client.listTools(req.params));
server.setRequestHandler(CallToolRequestSchema, async (req) => (await client.callTool(req.params)) as never);
server.setRequestHandler(ListPromptsRequestSchema, async (req) => client.listPrompts(req.params));
server.setRequestHandler(GetPromptRequestSchema, async (req) => client.getPrompt(req.params));

await server.connect(new StdioServerTransport());
process.stderr.write(`SosyalPilot MCP köprüsü hazır → ${base}/mcp\n`);
