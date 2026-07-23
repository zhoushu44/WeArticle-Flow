# Debug Session: cos-image-preview

- Status: [OPEN]
- Symptom: 候选图选中后可显示，上传 COS 并替换为 HTTPS URL 后，预览中的 img 不显示。
- Expected: COS 上传完成后，预览区中的封面和正文图片继续正常显示。

## Hypotheses

1. COS URL 请求返回 403/404，img 已插入但资源加载失败。
2. COS 响应内容类型或返回内容无法被浏览器解码为图片。
3. 流式上传回包使用旧 HTML，连续状态更新互相覆盖。
4. COS 防盗链、跨域或浏览器安全策略阻止图片加载。
5. React 预览重新挂载时 HTML 与 uploadedImages 状态不同步。

## Evidence

- 浏览器对指定 COS URL 创建独立 `Image()`：触发 `error`，未获得自然尺寸。
- 浏览器对同一 URL 执行 `fetch(..., { cache: 'no-store' })`：`TypeError: Failed to fetch`。
- 当前预览中的 base64 候选图可正常显示，说明 React 预览和 `<img>` 基础渲染路径可用。
- 已加入临时网络上报，待重启 API 并复现后记录实际预览图片的 load/error、naturalWidth 和 URL。

## Fix

等待证据确认后实施。

## Verification

等待修复后复测。
