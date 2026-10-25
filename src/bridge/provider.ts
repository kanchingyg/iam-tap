import { stripRedactedThinking } from "./tool-json.js";
import type { ChatMessage, LlmProvider, ReasoningState, ToolChoice } from "./types.js";

const REASONING_MODEL_PATTERNS = [
    /deepseek-reasoner/i,
    /qwq/i,
    /glm-z1/i,
    /kimi-k2-thinking/i,
    /thinking/i,
];
const FORBIDDEN_SAMPLING = new Set([
    "temperature",
    "top_p",
    "presence_penalty",
    "frequency_penalty",
]);
export function detectProvider(baseUrl: string, model?: string): LlmProvider {
    const u = baseUrl.toLowerCase();
    const m = (model ?? "").toLowerCase();
    if (u.includes("deepseek"))
        return "deepseek";
    if (u.includes("dashscope"))
        return "dashscope";
    if (u.includes("moonshot"))
        return "moonshot";
    if (u.includes("bigmodel") || u.includes("zhipu"))
        return "zhipu";
    if (u.includes("minimax"))
        return "minimax";
    if (u.includes("siliconflow"))
        return "siliconflow";
    if (u.includes("volces") || u.includes("doubao"))
        return "doubao";
    if (u.includes("stepfun"))
        return "stepfun";
    if (u.includes("01.ai") || m.startsWith("yi-"))
        return "yi";
    if (u.includes("11434") || u.includes("ollama"))
        return "ollama";
    if (u.includes("anthropic"))
        return "anthropic";
    if (u.includes("openai"))
        return "openai";
    return "generic";
}
export function isReasoningModel(model: string) {
    return REASONING_MODEL_PATTERNS.some((re) => re.test(model));
}
export function sanitizeRequestBody(body: Record<string, unknown>, model: string) {
    const out = { ...body };
    if (isReasoningModel(model)) {
        for (const key of FORBIDDEN_SAMPLING) {
            delete out[key];
        }
    }
    return out;
}
export function normalizeToolChoice(toolChoice: ToolChoice, provider: LlmProvider) {
    if (toolChoice === "required" || toolChoice === "any") {
        switch (provider) {
            case "dashscope":
            case "moonshot":
            case "zhipu":
            case "minimax":
            case "siliconflow":
            case "doubao":
                return "auto";
            default:
                return toolChoice;
        }
    }
    if (typeof toolChoice === "object" && toolChoice !== null) {
        if (provider === "dashscope" && toolChoice.type === "function" && toolChoice.function?.name) {
            return { type: "function", function: { name: toolChoice.function.name } };
        }
    }
    return toolChoice;
}
export function createReasoningState(): ReasoningState {
    return { inToolLoop: false, lastUserTurnIndex: -1 };
}
export function applyReasoningContentPolicy(messages: ChatMessage[], state: ReasoningState) {
    let lastUser = -1;
    for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === "user")
            lastUser = i;
    }
    const newUserTurn = lastUser > state.lastUserTurnIndex;
    if (newUserTurn) {
        state = { ...state, lastUserTurnIndex: lastUser, inToolLoop: false };
    }
    const hasPendingTools = messages.some(
        (m) => m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0,
    );
    if (hasPendingTools)
        state = { ...state, inToolLoop: true };
    const cleaned = messages.map((m, idx) => {
        const copy = { ...m };
        if (copy.content && typeof copy.content === "string") {
            copy.content = stripRedactedThinking(copy.content);
        }
        if (newUserTurn && copy.role === "assistant" && idx < lastUser) {
            delete copy.reasoning_content;
        }
        if (!state.inToolLoop && copy.role === "assistant") {
            delete copy.reasoning_content;
        }
        return copy;
    });
    return { messages: cleaned, state };
}
export function prepareAssistantForToolStep(msg: ChatMessage) {
    if (!msg.reasoning_content && msg.content) {
        const think = msg.content.match(/<think>([\s\S]*?)<\/redacted_thinking>/i);
        if (think) {
            return {
                ...msg,
                reasoning_content: think[1].trim(),
                content: stripRedactedThinking(msg.content ?? ""),
            };
        }
    }
    return msg;
}
