# 后记 · Afterword

> Another glow, after every story.

记录你看过的影视、读过的书和漫画、玩过的游戏。单人使用、开源、部署在 Cloudflare 上：你 fork 一份、部署一份，就有了一个只属于自己的“豆瓣标记页”。

- **四种作品**：影视、书、漫画、游戏
- **三种状态**：想看 / 在看 / 看过（读、玩同理），可打 1–5 星、写短评、记日期
- **公开主页**：所有人可以浏览你的标记；只有你登录后能添加和修改
- **条目来源**：Bangumi（漫画、动画、书、游戏，免 key）、TMDB（影视，需 key）、Google Books（书，需 key），都搜不到就手动添加
- **封面转存**：标记时把封面复制到 R2，不怕源站图片失效

技术栈：React Router（SSR）+ Cloudflare Workers + D1 + R2。

## 本地开发

```sh
npm install
cp .dev.vars.example .dev.vars   # 填写 OWNER_PASSWORD 和 SESSION_SECRET
npm run db:migrate:local
npm run dev
```

打开 http://localhost:5173 ，访问 `/login` 用 `OWNER_PASSWORD` 登录。

## 部署到 Cloudflare

```sh
npx wrangler d1 create afterword          # 把输出的 database_id 填进 wrangler.jsonc
npx wrangler r2 bucket create afterword-covers
npm run db:migrate                        # 在远端 D1 上建表

npx wrangler secret put OWNER_PASSWORD
npx wrangler secret put SESSION_SECRET    # 例如 openssl rand -hex 32 的输出
npx wrangler secret put TMDB_API_KEY      # 可选
npx wrangler secret put GOOGLE_BOOKS_API_KEY  # 可选

npm run deploy
```

在 `wrangler.jsonc` 的 `vars.OWNER_NAME` 里改成你的名字。

## 条目数据源

| 类型 | 数据源 | 需要配置 |
| --- | --- | --- |
| 影视 | Bangumi（动画、三次元）、TMDB | TMDB 需 `TMDB_API_KEY`（API key 或 v4 read token） |
| 书 | Bangumi、Google Books | Google Books 需 `GOOGLE_BOOKS_API_KEY` |
| 漫画 | Bangumi | — |
| 游戏 | Bangumi | — |

## License

MIT
