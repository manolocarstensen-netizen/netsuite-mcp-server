import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import OAuth from "oauth-1.0a";
import crypto from "crypto";

const NS_ACCOUNT_ID = process.env.NS_ACCOUNT_ID || "6736762";
const NS_CONSUMER_KEY = process.env.NS_CONSUMER_KEY;
const NS_CONSUMER_SECRET = process.env.NS_CONSUMER_SECRET;
const NS_TOKEN_ID = process.env.NS_TOKEN_ID;
const NS_TOKEN_SECRET = process.env.NS_TOKEN_SECRET;
const NS_BASE_URL = `https://${NS_ACCOUNT_ID}.suitetalk.api.netsuite.com`;

const oauth = OAuth({
  consumer: { key: NS_CONSUMER_KEY, secret: NS_CONSUMER_SECRET },
  signature_method: "HMAC-SHA256",
  hash_function(baseString, key) {
    return crypto.createHmac("sha256", key).update(baseString).digest("base64");
  },
});
const token = { key: NS_TOKEN_ID, secret: NS_TOKEN_SECRET };

async function nsRequest(method, endpoint, body = null) {
  const url = `${NS_BASE_URL}${endpoint}`;
  const requestData = { url, method };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));
  authHeader.Authorization += `, realm="${NS_ACCOUNT_ID}"`;
  const headers = { ...authHeader, "Content-Type": "application/json", "Accept": "application/json" };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) { const text = await res.text(); throw new Error(`NetSuite API error ${res.status}: ${text}`); }
  return res.json();
}

async function executeSuiteQL(query, limit = 100, offset = 0) {
  const url = `${NS_BASE_URL}/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`;
  const requestData = { url, method: "POST" };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));
  authHeader.Authorization += `, realm="${NS_ACCOUNT_ID}"`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeader, "Content-Type": "application/json", "Accept": "application/json", "Prefer": "transient" },
    body: JSON.stringify({ q: query }),
  });
  if (!res.ok) { const text = await res.text(); throw new Error(`SuiteQL error ${res.status}: ${text}`); }
  return res.json();
}

const server = new McpServer({ name: "netsuite", version: "1.0.0" });

server.tool("suiteql_query", "Execute a SuiteQL query against NetSuite", {
  query: z.string().describe("The SuiteQL query"),
  limit: z.number().optional().default(100),
  offset: z.number().optional().default(0),
}, async ({ query, limit, offset }) => {
  const result = await executeSuiteQL(query, limit, offset);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

server.tool("get_record", "Get a NetSuite record by type and ID", {
  recordType: z.string().describe("Record type"),
  id: z.string().describe("Internal ID"),
  expandSubResources: z.boolean().optional().default(false),
}, async ({ recordType, id, expandSubResources }) => {
  let ep = `/services/rest/record/v1/${recordType}/${id}`;
  if (expandSubResources) ep += "?expandSubResources=true";
  const result = await nsRequest("GET", ep);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

server.tool("search_records", "Search NetSuite records via SuiteQL", {
  recordType: z.string(),
  fields: z.string().optional().default("*"),
  condition: z.string().optional(),
  orderBy: z.string().optional(),
  limit: z.number().optional().default(50),
}, async ({ recordType, fields, condition, orderBy, limit }) => {
  let q = `SELECT ${fields} FROM ${recordType}`;
  if (condition) q += ` WHERE ${condition}`;
  if (orderBy) q += ` ORDER BY ${orderBy}`;
  const result = await executeSuiteQL(q, limit);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

server.tool("create_record", "Create a new NetSuite record", {
  recordType: z.string(), data: z.string(),
}, async ({ recordType, data }) => {
  const result = await nsRequest("POST", `/services/rest/record/v1/${recordType}`, JSON.parse(data));
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

server.tool("update_record", "Update a NetSuite record", {
  recordType: z.string(), id: z.string(), data: z.string(),
}, async ({ recordType, id, data }) => {
  const result = await nsRequest("PATCH", `/services/rest/record/v1/${recordType}/${id}`, JSON.parse(data));
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

server.tool("list_metadata", "Get NetSuite REST API metadata", {
  recordType: z.string().optional(),
}, async ({ recordType }) => {
  const ep = recordType ? `/services/rest/record/v1/metadata-catalog/${recordType}` : "/services/rest/record/v1/metadata-catalog/";
  const result = await nsRequest("GET", ep);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("NetSuite MCP Server running on stdio");
}
main().catch(console.error);
