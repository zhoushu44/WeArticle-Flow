# Debug image stream error

Status: [OPEN]

## Symptom
前端提示“候选图服务未返回流式结果，请确认本地 API 正在运行”。

## Hypotheses
1. API 返回 JSON 错误而非流式响应。
2. API 仍由旧进程提供，未加载流式接口。
3. Vite 代理或服务端响应头导致流式响应不可读。
4. 后端在首张图片生成前被上游请求阻塞或报错。

## Evidence
- 127.0.0.1:8787 is listening, but a direct image request timed out after 12 seconds before response headers.
- 127.0.0.1:5173 proxy request also timed out after 12 seconds.
- The route sets NDJSON headers only after entering the handler, but did not flush headers before awaiting upstream image generation.

## Conclusion
Hypothesis 4 confirmed: the upstream generation blocks before the client can obtain a readable streaming response. Hypotheses 1 and 3 are not supported by the timeout evidence; hypothesis 2 is not yet confirmed.

## Fix
Flush streaming headers immediately and disable response transformation/buffering headers.
