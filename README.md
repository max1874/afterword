# 后记 · Afterword

> Another glow, after every story.

记录你看过的影视、读过的书和漫画、玩过的游戏。开源、部署在 Cloudflare 上：部署一份，你和你邀请的朋友各有一个自己的“豆瓣标记页”。

- **四种作品**：影视、书、漫画、游戏
- **三种状态**：想看 / 在看 / 看过（读、玩同理），可打 1–5 星、写短评、记日期
- **个人主页**：每人一个 `/@用户名` 主页，所有人可以浏览，只有本人能添加和修改；作品条目大家共用，标记各归各
- **账号**：通行密钥（passkey）登录，不用密码；邀请链接注册；恢复码兜底；可查看并退出登录过的设备
- **条目来源**：豆瓣（影视、书）、Bangumi（漫画、动画、书、游戏）、TMDB（影视，需 key）、Google Books（书，需 key），都搜不到就手动添加
- **封面转存**：标记时把封面复制到 R2，不怕源站图片失效

技术栈：React Router（SSR）+ Cloudflare Workers + D1 + R2。

## 本地开发

```sh
npm install
cp .dev.vars.example .dev.vars   # 填写 OWNER_PASSWORD
npm run db:migrate:local
npm run dev
```

打开 http://localhost:5173 ，按首页提示进入 `/setup`：输入 `OWNER_PASSWORD`、选用户名，创建通行密钥。已有的标记都归这个管理员账号。之后在“设置”里生成邀请链接给别人注册。

## 部署到 Cloudflare

```sh
npx wrangler d1 create afterword          # 把输出的 database_id 填进 wrangler.jsonc
npx wrangler r2 bucket create afterword-covers
npm run db:migrate                        # 在远端 D1 上建表

npx wrangler secret put OWNER_PASSWORD    # 只在 /setup 创建第一个通行密钥时用一次
npx wrangler secret put TMDB_API_KEY      # 可选
npx wrangler secret put GOOGLE_BOOKS_API_KEY  # 可选

npm run deploy
```

部署后打开站点完成 `/setup`。在 `wrangler.jsonc` 里把 `routes` 改成你自己的域名（域名需要托管在同一个 Cloudflare 账号下；没有域名就删掉 `routes`、把 `workers_dev` 改成 `true`）。

作者的实例：https://afterword.max1874.com

## 条目数据源

| 类型 | 数据源 | 需要配置 |
| --- | --- | --- |
| 影视 | 豆瓣、Bangumi（动画、三次元）、TMDB | TMDB 需 `TMDB_API_KEY`（API key 或 v4 read token） |
| 书 | 豆瓣、Bangumi、Google Books | Google Books 需 `GOOGLE_BOOKS_API_KEY` |
| 漫画 | Bangumi | — |
| 游戏 | Bangumi | — |

## License

MIT
