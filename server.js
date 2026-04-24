const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

app.use(cors());
app.use(express.json());

const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

const SHOW_REASONING = false;
const ENABLE_THINKING_MODE = false;

const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'gpt-4': 'qwen/qwen3-coder-480b-a35b-instruct',
  'gpt-4-turbo': 'moonshotai/kimi-k2-instruct-0905',
  'gpt-4o': 'deepseek-ai/deepseek-v3.1',
  'claude-3-opus': 'openai/gpt-oss-120b',
  'claude-3-sonnet': 'openai/gpt-oss-20b',
  'gemini-pro': 'qwen/qwen3-next-80b-a3b-thinking',
  'gpt-4-32k': 'deepseek-ai/deepseek-r1',
  'gpt-4-terminus': 'deepseek-ai/deepseek-v3.1-terminus',
  'gpt-4a': 'deepseek-ai/deepseek-v3.2',
  'nemotron-super': 'nvidia/nemotron-3-super-120b-a12b',
  'nemotron-mini': 'nvidia/nemotron-mini-4b-instruct',
  'gemma-4': 'google/gemma-4-31b-it',
  'glm-4-roleplay': 'z-ai/glm4_7',
  'llama-70b': 'meta/llama-3.3-70b-instruct',
  'llama-70b-v1': 'meta/llama-3.1-70b-instruct',
  'mistral': 'mistralai/mistral-large-2-instruct',
  'mistral-small': 'mistralai/mistral-small-3-1-24b-instruct',
  'llama-maverick': 'meta/llama-4-maverick-17b-128e-instruct',
  'llama-scout': 'meta/llama-4-scout-17b-16e-instruct',

  // New confirmed models - great for instruction following + roleplay
  'minimax': 'minimax-ai/minimax-m2.7',
  'glm-5': 'z-ai/glm-5-1',
  'glm-4': 'z-ai/glm-4-7',
  'mistral-small-4': 'mistralai/mistral-small-4-119b-2603',
  'nemotron-nano': 'nvidia/nemotron-3-nano-30b-a3b',
  'nemotron-ultra': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'qwen3-5': 'qwen/qwen3.5-122b-a22b-instruct',
  'moonshot': 'moonshotai/kimi-k2-instruct-0905'
};

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'OpenAI to NVIDIA NIM Proxy' });
});

app.get('/v1/models', (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map(model => ({
    id: model, object: 'model', created: Date.now(), owned_by: 'nvidia-nim-proxy'
  }));
  res.json({ object: 'list', data: models });
});

function cleanContent(content) {
  content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const markerIndex = content.indexOf('</start>');
  if (markerIndex !== -1) {
    content = content.slice(markerIndex + '</start>'.length).trim();
  }
  return content;
}

app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;
    const nimModel = MODEL_MAPPING[model] || 'meta/llama-3.1-8b-instruct';

    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    const reinforcedMessages = [
      ...systemMessages,
      ...otherMessages.slice(0, -1),
      {
        role: 'system',
        content: `(Start off this message with "RESPONSE:")'
