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
  'gpt-4o': 'deepseek-ai/deepseek-v4-pro',
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
  'minimax': 'minimax-ai/minimax-m2.7',
  'glm-5': 'z-ai/glm-5-1',
  'glm-4': 'z-ai/glm-4-7',
  'glm-5.1': 'z-ai/glm-5.1',
  'kimi2': 'moonshotai/kimi-k2-instruct',
  'kimi2-think': 'moonshotai/kimi-k2-thinking',
  'kimi2a': 'moonshotai/kimi-k2.6',
  'mistral-small-4': 'mistralai/mistral-small-4-119b-2603',
  'nemotron-nano': 'nvidia/nemotron-3-nano-30b-a3b',
  'nemotron-ultra': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'qwen3-5': 'qwen/qwen3.5-122b-a22b-instruct',
  'mistral-3': 'mistralai/mistral-large-3-675b-instruct-2512',
  'mistralai': 'mistralai/mistral-medium-3-instruct'
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

    // Add reminder to last user message every message
    const lastMessage = otherMessages[otherMessages.length - 1];
    const modifiedLastMessage = {
      ...lastMessage,
      content: lastMessage.content + '\n\n(Follow the manual, Include spaces and emotions)'
    };

    const reinforcedMessages = [
      ...systemMessages,
      ...otherMessages.slice(0, -1),
      modifiedLastMessage
    ];

    const nimRequest = {
      model: nimModel,
      messages: reinforcedMessages,
      temperature: temperature || 0.5,
      max_tokens: max_tokens || 8192,
      stream: false
    };

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
        headers: {
          'Authorization': `Bearer ${NIM_API_KEY}`,
          'Content-Type': 'application/json'
        },
        responseType: 'stream'
      });

      let buffer = '';
      response.data.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        lines.forEach(line => {
          if (line.startsWith('data: ')) {
            if (line.includes('[DONE]')) {
              res.write('data: [DONE]\n\n');
              return;
            }
            try {
              const data = JSON.parse(line.slice(6));
              if (data.choices?.[0]?.delta) {
                const reasoning = data.choices[0].delta.reasoning_content;
                const content = data.choices[0].delta.content;
                if (SHOW_REASONING && reasoning) {
                  data.choices[0].delta.content = reasoning;
                } else {
                  data.choices[0].delta.content = content || '';
                }
                delete data.choices[0].delta.reasoning_content;
              }
              res.write(`data: ${JSON.stringify(data)}\n\n`);
            } catch (e) {
              res.write(line + '\n');
            }
          }
        });
      });

      response.data.on('end', () => res.end());
      response.data.on('error', () => res.end());

    } else {
      const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
        headers: {
          'Authorization': `Bearer ${NIM_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      res.json({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: response.data.choices.map(choice => {
          let content = choice.message.content || '';
          content = cleanContent(content);
          return {
            index: choice.index,
            message: { role: choice.message.role, content },
            finish_reason: choice.finish_reason
          };
        }),
        usage: response.data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      });
    }

  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: { message: error.message || 'Internal server error', type: 'invalid_request_error' }
    });
  }
});

app.all('*', (req, res) => {
  res.status(404).json({ error: { message: `Endpoint ${req.path} not found` } });
});

module.exports = app;
