# NEXUS AGENTS v16.0 — الكود الكامل للمنصة

> منصة دردشة ذكاء اصطناعي عربية RTL مع 14 وكيلاً متخصصاً، 3 مزودين (Anthropic / OpenAI / Google)، بث SSE، قاعدة بيانات PostgreSQL، وتصميم سايبر داكن.

---

## هيكل المشروع

```
nexus-agents/
├── artifacts/
│   ├── api-server/          ← خادم Express (Node.js)
│   │   └── src/routes/
│   │       ├── chat.ts        ← بث AI عبر SSE
│   │       ├── conversations.ts
│   │       ├── feedback.ts
│   │       ├── roaming.ts
│   │       ├── stats.ts
│   │       └── index.ts
│   └── nexus-agents/        ← واجهة React + Vite
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── index.css
│           ├── lib/agents.ts
│           ├── hooks/use-mobile.tsx
│           └── components/
│               ├── ChatArea.tsx
│               ├── SettingsModal.tsx
│               └── Markdown.tsx
└── lib/
    ├── db/src/schema/       ← Drizzle ORM
    │   ├── conversations.ts
    │   ├── feedback.ts
    │   └── roaming.ts
    └── api-spec/openapi.yaml
```

---

## 1. قاعدة البيانات — lib/db/src/schema/

### conversations.ts
```typescript
import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const conversationsTable = pgTable("conversations", {
  id: serial("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  agentName: text("agent_name").notNull(),
  agentIcon: text("agent_icon"),
  mode: text("mode").notNull().default("single"),
  messages: text("messages").notNull().default("[]"),
  messageCount: integer("message_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertConversationSchema = createInsertSchema(conversationsTable).omit({ id: true, createdAt: true });
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversationsTable.$inferSelect;
```

### feedback.ts
```typescript
import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const feedbackTable = pgTable("feedback", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id"),
  messageIndex: integer("message_index").notNull(),
  feedbackType: text("feedback_type").notNull(),
  messageSnippet: text("message_snippet"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFeedbackSchema = createInsertSchema(feedbackTable).omit({ id: true, createdAt: true });
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
export type Feedback = typeof feedbackTable.$inferSelect;
```

### roaming.ts
```typescript
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const roamingSuggestionsTable = pgTable("roaming_suggestions", {
  id: serial("id").primaryKey(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertRoamingSuggestionSchema = createInsertSchema(roamingSuggestionsTable).omit({ id: true, createdAt: true });
export type InsertRoamingSuggestion = z.infer<typeof insertRoamingSuggestionSchema>;
export type RoamingSuggestion = typeof roamingSuggestionsTable.$inferSelect;
```

---

## 2. API Server — artifacts/api-server/src/routes/

### chat.ts
```typescript
import { Router, type IRouter } from "express";

const router: IRouter = Router();

// مفاتيح الخادم (تُضبط عبر Replit Secrets)
const SERVER_KEYS = {
  anthropic: process.env.ANTHROPIC_API_KEY,
  openai: process.env.OPENAI_API_KEY,
  google: process.env.GEMINI_API_KEY,
};

export function getAvailableProviders(): string[] {
  return Object.entries(SERVER_KEYS)
    .filter(([, key]) => !!key)
    .map(([provider]) => provider);
}

router.get("/providers", (_req, res) => {
  const available = getAvailableProviders();
  res.json({ providers: available, hasServerKeys: available.length > 0 });
});

router.post("/chat", async (req, res): Promise<void> => {
  const { provider, modelName, systemPrompt, messages, apiKey } = req.body as {
    provider: string;
    modelName: string;
    systemPrompt: string;
    messages: { role: string; content: string }[];
    apiKey?: string;
  };

  if (!provider || !modelName || !messages) {
    res.status(400).json({ error: "provider, modelName, and messages are required" });
    return;
  }

  // مفتاح المستخدم أولاً، ثم مفتاح الخادم
  const resolvedKey = apiKey?.trim() || SERVER_KEYS[provider as keyof typeof SERVER_KEYS];

  if (!resolvedKey) {
    res.status(401).json({
      error: `لا يوجد مفتاح API لـ ${provider}. أضف مفتاحك في الإعدادات أو اطلب من المدير إضافة ${provider.toUpperCase()}_API_KEY.`,
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendChunk = (text: string) => res.write(`data: ${JSON.stringify({ text })}\n\n`);
  const sendDone  = () => { res.write("data: [DONE]\n\n"); res.end(); };
  const sendError = (msg: string) => { res.write(`data: ${JSON.stringify({ error: msg })}\n\n`); res.end(); };

  try {
    if (provider === "anthropic") {
      await streamAnthropic({ apiKey: resolvedKey, modelName, systemPrompt, messages, sendChunk, sendDone, sendError });
    } else if (provider === "openai") {
      await streamOpenAI({ apiKey: resolvedKey, modelName, systemPrompt, messages, sendChunk, sendDone, sendError });
    } else if (provider === "google") {
      await streamGemini({ apiKey: resolvedKey, modelName, systemPrompt, messages, sendChunk, sendDone, sendError });
    } else {
      sendError(`مزود غير مدعوم: ${provider}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Chat proxy error");
    sendError(msg);
  }
});

type StreamParams = {
  apiKey: string; modelName: string; systemPrompt: string;
  messages: { role: string; content: string }[];
  sendChunk: (t: string) => void; sendDone: () => void; sendError: (m: string) => void;
};

async function streamAnthropic({ apiKey, modelName, messages, systemPrompt, sendChunk, sendDone, sendError }: StreamParams) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: modelName, max_tokens: 4096, system: systemPrompt,
      messages: messages.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
      stream: true,
    }),
  });
  if (!resp.ok) { sendError(`Anthropic: ${resp.status} — ${await resp.text()}`); return; }
  const reader = resp.body?.getReader();
  if (!reader) { sendError("No response body"); return; }
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") { sendDone(); return; }
      try {
        const p = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string } };
        if (p.type === "content_block_delta" && p.delta?.type === "text_delta" && p.delta.text) sendChunk(p.delta.text);
      } catch {}
    }
  }
  sendDone();
}

async function streamOpenAI({ apiKey, modelName, messages, systemPrompt, sendChunk, sendDone, sendError }: StreamParams) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: "system", content: systemPrompt }, ...messages.map(m => ({ role: m.role, content: m.content }))],
      stream: true,
    }),
  });
  if (!resp.ok) { sendError(`OpenAI: ${resp.status} — ${await resp.text()}`); return; }
  const reader = resp.body?.getReader();
  if (!reader) { sendError("No response body"); return; }
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") { sendDone(); return; }
      try {
        const p = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const content = p.choices?.[0]?.delta?.content;
        if (content) sendChunk(content);
      } catch {}
    }
  }
  sendDone();
}

async function streamGemini({ apiKey, modelName, messages, systemPrompt, sendChunk, sendDone, sendError }: StreamParams) {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?key=${apiKey}&alt=sse`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      }),
    }
  );
  if (!resp.ok) { sendError(`Gemini: ${resp.status} — ${await resp.text()}`); return; }
  const reader = resp.body?.getReader();
  if (!reader) { sendError("No response body"); return; }
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const p = JSON.parse(line.slice(6).trim()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const text = p.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) sendChunk(text);
      } catch {}
    }
  }
  sendDone();
}

export default router;
```

### conversations.ts
```typescript
import { Router, type IRouter } from "express";
import { db, conversationsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { SaveConversationBody, DeleteConversationParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/conversations", async (req, res): Promise<void> => {
  const rows = await db.select().from(conversationsTable).orderBy(desc(conversationsTable.createdAt));
  res.json(rows);
});

router.post("/conversations", async (req, res): Promise<void> => {
  const parsed = SaveConversationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(conversationsTable).values({
    agentId: parsed.data.agentId, agentName: parsed.data.agentName,
    agentIcon: parsed.data.agentIcon ?? null, mode: parsed.data.mode,
    messages: parsed.data.messages,
    messageCount: (() => { try { const a = JSON.parse(parsed.data.messages) as unknown[]; return Array.isArray(a) ? a.length : 0; } catch { return 0; } })(),
  }).returning();
  res.status(201).json(row);
});

router.delete("/conversations/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteConversationParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.delete(conversationsTable).where(eq(conversationsTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

export default router;
```

### feedback.ts
```typescript
import { Router, type IRouter } from "express";
import { db, feedbackTable } from "@workspace/db";
import { SaveFeedbackBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/feedback", async (req, res): Promise<void> => {
  const parsed = SaveFeedbackBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(feedbackTable).values({
    conversationId: parsed.data.conversationId ?? null,
    messageIndex: parsed.data.messageIndex,
    feedbackType: parsed.data.feedbackType,
    messageSnippet: parsed.data.messageSnippet ?? null,
  }).returning();
  res.status(201).json(row);
});

export default router;
```

### stats.ts
```typescript
import { Router, type IRouter } from "express";
import { db, conversationsTable, feedbackTable } from "@workspace/db";
import { sql, count } from "drizzle-orm";

const router: IRouter = Router();

router.get("/stats", async (_req, res): Promise<void> => {
  const [convRow] = await db.select({ total: count() }).from(conversationsTable);
  const [fbRow]   = await db.select({ total: count() }).from(feedbackTable);
  const totalMessages = await db
    .select({ total: sql<number>`coalesce(sum(${conversationsTable.messageCount}), 0)` })
    .from(conversationsTable);
  const topAgentRows = await db
    .select({ agentName: conversationsTable.agentName, cnt: count() })
    .from(conversationsTable)
    .groupBy(conversationsTable.agentName)
    .orderBy(sql`count(*) desc`)
    .limit(1);
  res.json({
    totalConversations: convRow?.total ?? 0,
    totalMessages: Number(totalMessages[0]?.total ?? 0),
    totalFeedback: fbRow?.total ?? 0,
    topAgent: topAgentRows[0]?.agentName ?? null,
  });
});

export default router;
```

---

## 3. Frontend — artifacts/nexus-agents/src/

### main.tsx
```typescript
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";

document.documentElement.dir = "rtl";
document.documentElement.lang = "ar";
document.documentElement.classList.add("dark");

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
```

### lib/agents.ts
```typescript
export type ProviderType = 'anthropic' | 'openai' | 'google';

export interface Agent {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: 'cyan' | 'purple' | 'orange' | 'green' | 'red';
  preferredProvider: ProviderType;
  preferredModel: string;
  providerLabel: string;
}

export const PROVIDER_DISPLAY: Record<ProviderType, { short: string; color: string; bg: string }> = {
  anthropic: { short: 'Claude',  color: 'text-[hsl(19,100%,70%)]',    bg: 'bg-[hsl(19_100%_60%/0.12)]'  },
  openai:    { short: 'GPT',     color: 'text-[hsl(159,100%,45%)]',   bg: 'bg-[hsl(159_100%_45%/0.12)]' },
  google:    { short: 'Gemini',  color: 'text-[hsl(217,100%,65%)]',   bg: 'bg-[hsl(217_100%_65%/0.12)]' },
};

export const AGENTS: Agent[] = [
  { id: 'manager',     name: 'الوكيل المدير',    description: 'إدارة وتوجيه الوكلاء وصياغة القرارات الاستراتيجية',   icon: 'UserCog',       color: 'cyan',   preferredProvider: 'anthropic', preferredModel: 'claude-3-5-sonnet-20241022', providerLabel: 'Claude Sonnet' },
  { id: 'accountant',  name: 'المحاسب',           description: 'التحليل المالي والحسابات الدقيقة وإعداد التقارير',     icon: 'Calculator',    color: 'green',  preferredProvider: 'openai',    preferredModel: 'gpt-4o',                    providerLabel: 'GPT-4o'       },
  { id: 'legal',       name: 'القانوني',           description: 'الاستشارات القانونية وصياغة العقود وتحليل المخاطر',   icon: 'Scale',         color: 'orange', preferredProvider: 'anthropic', preferredModel: 'claude-3-5-sonnet-20241022', providerLabel: 'Claude Sonnet' },
  { id: 'hr',          name: 'الموارد البشرية',   description: 'إدارة شؤون الموظفين والتوظيف وتطوير بيئة العمل',      icon: 'Users',         color: 'purple', preferredProvider: 'openai',    preferredModel: 'gpt-4o',                    providerLabel: 'GPT-4o'       },
  { id: 'investor',    name: 'المستثمر',           description: 'تحليل الاستثمارات والأسواق المالية وتقييم المخاطر',   icon: 'TrendingUp',    color: 'cyan',   preferredProvider: 'anthropic', preferredModel: 'claude-3-5-sonnet-20241022', providerLabel: 'Claude Sonnet' },
  { id: 'marketing',   name: 'التسويق',            description: 'استراتيجيات التسويق الرقمي والمبيعات وبناء العلامة',  icon: 'Megaphone',     color: 'red',    preferredProvider: 'openai',    preferredModel: 'gpt-4o',                    providerLabel: 'GPT-4o'       },
  { id: 'innovator',   name: 'المبتكر',            description: 'توليد الأفكار الإبداعية والابتكار وحل المشكلات',      icon: 'Lightbulb',     color: 'orange', preferredProvider: 'google',    preferredModel: 'gemini-1.5-pro',             providerLabel: 'Gemini Pro'   },
  { id: 'researcher',  name: 'الباحث',             description: 'البحث العلمي المعمق وجمع البيانات وتحليل المصادر',    icon: 'Search',        color: 'cyan',   preferredProvider: 'anthropic', preferredModel: 'claude-3-5-sonnet-20241022', providerLabel: 'Claude Sonnet' },
  { id: 'data_analyst',name: 'محلل البيانات',      description: 'تحليل البيانات المعقدة واستخراج الأنماط والنماذج',    icon: 'BarChart',      color: 'purple', preferredProvider: 'openai',    preferredModel: 'gpt-4o',                    providerLabel: 'GPT-4o'       },
  { id: 'security',    name: 'الأمن',              description: 'الأمن السيبراني وتحليل المخاطر الرقمية وحماية النظم', icon: 'Shield',        color: 'red',    preferredProvider: 'anthropic', preferredModel: 'claude-3-5-sonnet-20241022', providerLabel: 'Claude Sonnet' },
  { id: 'strategy',    name: 'الاستراتيجية',       description: 'التخطيط الاستراتيجي للأعمال وتحليل السوق والمنافسين',icon: 'Target',        color: 'green',  preferredProvider: 'anthropic', preferredModel: 'claude-3-5-sonnet-20241022', providerLabel: 'Claude Sonnet' },
  { id: 'education',   name: 'التعليم',            description: 'التطوير المهني والتدريب وتصميم المناهج التعليمية',    icon: 'GraduationCap', color: 'orange', preferredProvider: 'openai',    preferredModel: 'gpt-4o',                    providerLabel: 'GPT-4o'       },
  { id: 'health',      name: 'الصحة',              description: 'الاستشارات الصحية والطبية العامة ومتابعة الصحة',      icon: 'HeartPulse',    color: 'red',    preferredProvider: 'anthropic', preferredModel: 'claude-3-5-sonnet-20241022', providerLabel: 'Claude Sonnet' },
  { id: 'support',     name: 'خدمة العملاء',       description: 'دعم العملاء وحل المشكلات وتحسين تجربة المستخدم',     icon: 'Headphones',    color: 'cyan',   preferredProvider: 'openai',    preferredModel: 'gpt-4o-mini',               providerLabel: 'GPT-4o Mini'  },
];
```

### hooks/use-mobile.tsx
```typescript
import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);
  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return !!isMobile;
}
```

### components/Markdown.tsx
```typescript
import React, { useState, useEffect } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface MarkdownProps { content: string; className?: string; }

export function Markdown({ content, className = '' }: MarkdownProps) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    (async () => {
      const rawHtml = await marked.parse(content);
      setHtml(DOMPurify.sanitize(rawHtml));
    })();
  }, [content]);
  return (
    <div
      className={`prose prose-invert prose-p:leading-relaxed prose-pre:bg-surface prose-pre:border-border max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      dir="auto"
    />
  );
}
```

### components/SettingsModal.tsx
```typescript
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2, XCircle, Server, Wifi, WifiOff, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { useGetProviders } from '@workspace/api-client-react';

const PROVIDER_LABELS: Record<string, { name: string; models: string[] }> = {
  anthropic: { name: 'Anthropic (Claude)', models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'] },
  openai:    { name: 'OpenAI (GPT)',       models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
  google:    { name: 'Google (Gemini)',    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash-exp'] },
};

export function SettingsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [provider, setProvider] = useState('anthropic');
  const [modelName, setModelName] = useState('claude-3-5-sonnet-20241022');
  const [apiKey, setApiKey] = useState('');
  const [testStatus, setTestStatus] = useState<'idle'|'testing'|'success'|'error'>('idle');
  const [testError, setTestError] = useState('');
  const { data: providersData, refetch } = useGetProviders();
  const serverProviders = providersData?.providers ?? [];

  useEffect(() => {
    if (open) {
      try {
        const s = JSON.parse(localStorage.getItem('nexus_settings') || '{}');
        if (s.provider) setProvider(s.provider);
        if (s.modelName) setModelName(s.modelName);
        if (s.apiKey) setApiKey(s.apiKey);
      } catch {}
      setTestStatus('idle'); setTestError('');
      refetch();
    }
  }, [open]);

  const isServerConnected = serverProviders.includes(provider);

  const handleSave = () => {
    localStorage.setItem('nexus_settings', JSON.stringify({ provider, modelName, apiKey }));
    toast.success('تم حفظ الإعدادات');
    onOpenChange(false);
  };

  const handleTestConnection = async () => {
    if (!apiKey.trim() && !isServerConnected) {
      setTestStatus('error'); setTestError('لا يوجد مفتاح API'); return;
    }
    setTestStatus('testing'); setTestError('');
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, modelName, apiKey: apiKey.trim(),
          systemPrompt: 'أنت مساعد مفيد.', messages: [{ role: 'user', content: 'مرحبا' }] }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `خطأ ${response.status}`);
      const reader = response.body?.getReader();
      if (reader) { await reader.read(); reader.cancel(); }
      setTestStatus('success');
    } catch (e: any) { setTestStatus('error'); setTestError(e.message || 'فشل'); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] bg-card border-primary/20" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-primary font-bold">إعدادات الاتصال بالذكاء الاصطناعي</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            اختر المزود والنموذج. إن كان متصلاً بالخادم فلا تحتاج لمفتاح API.
          </DialogDescription>
        </DialogHeader>
        {/* حالة المزودين على الخادم */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Server className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-bold text-muted-foreground uppercase">اتصال الخادم المباشر</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(PROVIDER_LABELS).map(([key, { name }]) => {
              const connected = serverProviders.includes(key);
              return (
                <button key={key} onClick={() => { setProvider(key); setModelName(PROVIDER_LABELS[key].models[0]); }}
                  className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-xs transition-all ${provider === key ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                  {connected ? <Wifi className="w-4 h-4 text-[hsl(159,100%,45%)]" /> : <WifiOff className="w-4 h-4" />}
                  <span className="text-[10px]">{name.split(' ')[0]}</span>
                  <span className={`text-[9px] ${connected ? 'text-[hsl(159,100%,45%)]' : 'text-muted-foreground'}`}>
                    {connected ? '● متصل' : '○ غير متصل'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label className="text-xs">النموذج</Label>
            <div className="flex gap-2">
              <Input value={modelName} onChange={e => setModelName(e.target.value)} className="font-mono text-left text-sm" dir="ltr" />
              <Select value={modelName} onValueChange={setModelName} dir="rtl">
                <SelectTrigger className="w-10 px-2"><span className="text-xs">▾</span></SelectTrigger>
                <SelectContent>
                  {(PROVIDER_LABELS[provider]?.models ?? []).map(m => <SelectItem key={m} value={m} className="font-mono text-xs">{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label className="text-xs flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" /> مفتاح API الشخصي
              {isServerConnected && <span className="text-[9px] bg-[hsl(159_100%_45%/0.1)] text-[hsl(159,100%,45%)] px-1.5 py-0.5 rounded-full">اختياري</span>}
            </Label>
            <Input type="password" value={apiKey} onChange={e => { setApiKey(e.target.value); setTestStatus('idle'); }}
              placeholder={isServerConnected ? 'اتركه فارغاً لاستخدام اتصال الخادم' : 'sk-... أو AIza...'}
              className="font-mono text-left text-sm" dir="ltr" />
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleTestConnection}
                disabled={testStatus === 'testing' || (!apiKey.trim() && !isServerConnected)} className="text-xs">
                {testStatus === 'testing' && <Loader2 className="w-3.5 h-3.5 ml-1.5 animate-spin" />}
                اختبار الاتصال
              </Button>
              {testStatus === 'success' && <div className="flex items-center gap-1 text-[hsl(159,100%,45%)] text-xs"><CheckCircle2 className="w-3.5 h-3.5" /> يعمل ✓</div>}
              {testStatus === 'error'   && <div className="flex items-center gap-1 text-destructive text-xs" title={testError}><XCircle className="w-3.5 h-3.5" /><span className="truncate max-w-[180px]">{testError}</span></div>}
            </div>
          </div>
        </div>
        <DialogFooter className="flex-row-reverse sm:justify-start gap-2 pt-2">
          <Button onClick={handleSave} className="bg-primary text-primary-foreground text-sm">حفظ التغييرات</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-sm">إلغاء</Button>
          <Button variant="ghost" className="text-destructive hover:bg-destructive/10 text-sm mr-auto"
            onClick={() => { localStorage.removeItem('nexus_settings'); setProvider('anthropic'); setModelName('claude-3-5-sonnet-20241022'); setApiKey(''); toast.success('تم مسح الإعدادات'); }}>
            مسح البيانات
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### components/ChatArea.tsx
> (الكود الكامل — أهم الأجزاء)

**منطق اختيار المزود:**
```typescript
// يستخدم إعداد المستخدم أولاً، ثم المزود المفضل للوكيل
const resolveProviderSettings = () => {
  const s = JSON.parse(localStorage.getItem('nexus_settings') || '{}');
  return {
    provider:  s.provider  || agent.preferredProvider,
    modelName: s.modelName || agent.preferredModel,
    apiKey:    s.apiKey    || '',
  };
};
```

**SSE Parser (بث مباشر):**
```typescript
const sendMessages = async (msgs: Message[]) => {
  const { provider, modelName, apiKey } = resolveProviderSettings();
  const response = await fetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ provider, modelName, apiKey, systemPrompt: `أنت ${agent.name}. ${agent.description}.`, messages: msgs }),
    signal: abortControllerRef.current?.signal,
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let assistantText = '';

  setMessages(prev => [...prev, { role: 'assistant', content: '', timestamp: Date.now() }]);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value, { stream: true }).split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') break;
      try {
        const parsed = JSON.parse(data);
        if (parsed.text) {             // ← المفتاح: "text" وليس "content"
          assistantText += parsed.text;
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { ...updated[updated.length - 1], content: assistantText };
            return updated;
          });
        }
        if (parsed.error) throw new Error(parsed.error);
      } catch {}
    }
  }
};
```

**ميزات المحادثة:**
- نسخ الرد (`Copy` + Toast)
- تعديل رسائل المستخدم وإعادة الإرسال
- تقييم الردود (👍 👎) محفوظ في قاعدة البيانات
- Text-to-Speech بالعربية (Web Speech API)
- مشاركة رابط المحادثة
- Timestamps على كل رسالة
- أزرار قوالب سريعة

### App.tsx — المنطق الرئيسي
```typescript
// نظام الألوان لبطاقات الوكلاء
const COLOR_MAP = {
  cyan:   { text: 'text-primary',    bg: 'bg-primary/10',    border: 'border-primary/30',    glow: 'group-hover:shadow-[0_0_24px_hsl(192_100%_50%/0.25)]' },
  purple: { text: 'text-secondary',  bg: 'bg-secondary/10',  border: 'border-secondary/30',  glow: 'group-hover:shadow-[0_0_24px_hsl(263_100%_59%/0.25)]' },
  orange: { text: 'text-accent',     bg: 'bg-accent/10',     border: 'border-accent/30',     glow: 'group-hover:shadow-[0_0_24px_hsl(19_100%_60%/0.25)]'  },
  green:  { text: 'text-[hsl(159,100%,45%)]', bg: 'bg-[hsl(159_100%_45%/0.1)]', border: 'border-[hsl(159_100%_45%/0.3)]', glow: '...' },
  red:    { text: 'text-destructive', bg: 'bg-destructive/10', border: 'border-destructive/30', glow: '...' },
};

// اختصارات لوحة المفاتيح
// N  → محادثة جديدة
// /  → فتح البحث في السجل
// Esc → إغلاق القوائم
```

**ميزات الـ Sidebar:**
- إحصائيات الجلسة (محادثات / رسائل / مستندات)
- أوضاع التعاون: منفرد / تعاوني / عميق
- رفع قاعدة المعرفة (PDF + نص)
- الوكلاء المتجولون (تحليل تلقائي)
- سجل المحادثات مع بحث + حذف

**Mobile Layout:**
- Sidebar drawer على اليمين (z-40)
- Bottom nav ثابت في الأسفل (4 تبويبات)
- شبكة وكلاء 2×2 على الموبايل

---

## 4. CSS Variables — index.css

```css
:root {
  --background: 220 75% 5%;     /* أزرق داكن جداً */
  --foreground: 210 100% 96%;   /* أبيض مائل للأزرق */
  --primary:    192 100% 50%;   /* سيان */
  --secondary:  263 100% 59%;   /* بنفسجي */
  --accent:     19 100% 60%;    /* برتقالي */
  --destructive: 356 100% 64%;  /* أحمر */
  --card:       220 60% 9%;
  --border:     220 65% 15%;
  --app-font-sans: 'Tajawal', sans-serif;
  --app-font-mono: 'Space Mono', monospace;
}
```

---

## 5. OpenAPI Contract — lib/api-spec/openapi.yaml

```
GET  /api/healthz              → health check
GET  /api/providers            → مزودو AI المتصلون بالخادم
POST /api/chat                 → بث SSE للذكاء الاصطناعي
GET  /api/conversations        → قائمة المحادثات
POST /api/conversations        → حفظ محادثة
DEL  /api/conversations/:id    → حذف محادثة
POST /api/feedback             → حفظ تقييم رسالة
GET  /api/roaming-suggestions  → اقتراحات الوكلاء المتجولين
POST /api/roaming-suggestions  → حفظ اقتراح
GET  /api/stats                → إحصائيات الاستخدام
```

---

## 6. متغيرات البيئة المطلوبة

| المتغير | الغرض | مطلوب؟ |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | **نعم** |
| `ANTHROPIC_API_KEY` | مفتاح Claude | اختياري (يعمل بدونه إن أدخله المستخدم) |
| `OPENAI_API_KEY` | مفتاح GPT | اختياري |
| `GEMINI_API_KEY` | مفتاح Gemini | اختياري |

---

## 7. أوامر التشغيل

```bash
# تشغيل الخادم
pnpm --filter @workspace/api-server run dev

# تشغيل الواجهة
pnpm --filter @workspace/nexus-agents run dev

# ترحيل قاعدة البيانات
pnpm --filter @workspace/db run push

# إعادة توليد الـ hooks من OpenAPI
pnpm --filter @workspace/api-spec run codegen

# فحص TypeScript
pnpm run typecheck
```

---

## 8. تدفق البيانات

```
المستخدم يكتب رسالة
     ↓
ChatArea.resolveProviderSettings()
     ↓ (provider + model + apiKey)
POST /api/chat  (SSE)
     ↓
chat.ts: resolvedKey = userKey || SERVER_KEY
     ↓
streamAnthropic() / streamOpenAI() / streamGemini()
     ↓ data: {"text": "..."}\n\n (streaming)
ChatArea: يحدّث آخر رسالة في real-time
     ↓
onSaveConversation() → POST /api/conversations
     ↓
PostgreSQL (conversationsTable)
```

---

*NEXUS AGENTS v16.0 — بُني بـ React + Express + PostgreSQL + Drizzle ORM*
