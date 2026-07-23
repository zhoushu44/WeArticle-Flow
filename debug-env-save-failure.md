# Debug Session: env-save-failure

- Status: [OPEN]
- Symptom: 设置页面无法保存本地 `.env` 配置。
- Expected: 点击“保存到 .env”后，服务端更新项目根目录 `.env`，前端显示保存成功。

## Hypotheses

1. API 服务没有运行或端口 8787 被其他服务占用。
2. `/api/settings` 保存接口返回 400/500/422。
3. 服务进程没有权限写入项目根目录 `.env`。
4. `.env` 文件只读、锁定，或服务端路径解析不正确。
5. 前端提交的数据为空或字段格式不符合服务端校验。

## Evidence

- API 正常监听 `0.0.0.0:8787`。
- 本机直接调用 `POST /api/settings` 返回 `{ ok: true, restartRequired: true }`，排除接口逻辑、请求格式和本机文件权限问题。
- 用户确认故障发生在 Docker 容器。
- `.dockerignore` 排除了 `.env`，Dockerfile 也未创建 `/app/.env`。
- `docker run --env-file .env` 只注入环境变量，不会创建容器内 `/app/.env`。
- 保存接口原先第一步执行 `readFile('/app/.env')`，文件不存在时进入 500 分支。

## Fix

- 新增 `readEnvContent()`：`.env` 不存在时从进程环境变量构造初始内容，保存时自动创建 `/app/.env`。
- README 的 Docker 命令增加 `-v "$(pwd)/.env:/app/.env"`，让页面修改持久化到宿主机。

## Verification

- `npm run check` 通过。
- `npm run build` 通过。
- `git diff --check -- api/server.ts README.md` 通过。
- 等待用户使用新镜像和挂载命令进行容器内复测。
