import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      /*
       * 恢复备份要上传整个 JSON 文件，而 Server Action 默认只收 1MB —— 一份
       * 几个月的备份就能超过它，用户会撞上一个看不懂的 413，还以为是文件坏了。
       *
       * 这个值是一条链上的中间一环，三者的关系决定了该怎么取：
       *
       *   4.0 MB  应用自己的上限（lib/backup.ts 的 MAX_BACKUP_BYTES）—— 超过就友好报错
       *   4.5 MB  Vercel 单个请求体的硬上限 —— 超过连代码都跑不到
       *   5 MB    这里 —— 必须比应用自己的上限大一点，好让超限的文件走进
       *           「文件太大了，最多 4MB」这句提示，而不是被框架先拦下来
       *
       * 5 MB 还留了余量：multipart 的 boundary、各段的头、字段名也占字节
       * （Next 文档给的估算是一条上传多留 10–20 KB）。
       * 上限一旦调大，记得先确认 Vercel 那一环还过得去。
       */
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
